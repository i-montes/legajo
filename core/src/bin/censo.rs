//! Censo completo contra un sitio real, para medir de verdad cuánto tarda.
//! Uso:  cargo run -p legajo-core --bin censo -- wordpress.org/news

use legajo_core::{census, contenido, discover, perfil, Auth, Db, Http};
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sitio = std::env::args().nth(1).unwrap_or_else(|| "wordpress.org/news".into());
    let http = Http::new()?;
    let t0 = Instant::now();

    println!("── descubriendo {sitio}");
    let d = discover(&http, &sitio).await?;
    let tax: Vec<String> = d.capabilities.taxonomies.iter().map(|t| t.rest_base.clone()).collect();
    println!("   {} · {:?} artículos · taxonomías {:?}",
        d.transport_label, d.capabilities.total_posts, tax);

    let ruta = std::env::temp_dir().join("legajo-censo-prueba.sqlite");
    let _ = std::fs::remove_file(&ruta);
    let db = Db::open(&ruta)?;
    let conn_id = db.upsert_connection(
        "prueba", &d.resolved_origin, &serde_json::to_string(&d.transport)?,
        &d.transport_label, d.site_name.as_deref(),
        d.capabilities.total_posts.map(|x| x as i64), "{}")?;

    println!("── términos");
    let terms = census::sincronizar_terminos(
        &http, &d.transport, &Auth::None, &tax,
        |tax, i, n| if !tax.is_empty() { println!("   {}/{n} · {tax}", i + 1) },
    ).await?;
    db.guardar_terminos(conn_id, &terms.items)?;
    println!("   {} términos en {:?}", terms.items.len(), t0.elapsed());
    for (t, n) in &terms.omitidas {
        println!("   omitida «{t}»: {n} términos, demasiados para estratificar");
    }

    let (desde, hasta) = census::rango_real(&http, &d.transport, &Auth::None).await?;
    let ventanas = census::ventanas_mensuales(desde, hasta);
    println!("── censo {desde}—{hasta} · {} ventanas", ventanas.len());

    let mut filas = 0usize;
    let mut anom = 0usize;
    let mut cuerpos = 0usize;
    let mut fallidas = 0usize;
    for (i, v) in ventanas.iter().enumerate() {
        match census::censar_ventana(&http, &d.transport, &Auth::None, v, &tax).await {
            Ok(lote) => {
                filas += lote.filas.len();
                anom += lote.anomalias.len();
                cuerpos += lote.cuerpos.len();
                db.guardar_censo(conn_id, &lote.filas)?;
                db.guardar_anomalias(conn_id, &lote.anomalias)?;
                // El texto llegó con los metadatos: se limpia y se guarda aquí
                // mismo, igual que en la app.
                let limpios: Vec<(i64, String, contenido::Limpio)> = lote.cuerpos
                    .into_iter()
                    .map(|(id, h)| { let l = contenido::limpiar(&h); (id, h, l) })
                    .collect();
                db.guardar_articulos(conn_id, &limpios)?;
                let medidas: Vec<_> = limpios.into_iter().map(|(id, _, l)| (id, l)).collect();
                db.guardar_sondeo(conn_id, &medidas)?;
                db.marcar_ventana(conn_id, &v.etiqueta, lote.filas.len())?;
            }
            Err(e) => { fallidas += 1; println!("   ! {} falló: {e}", v.etiqueta); }
        }
        if i % 24 == 0 || i + 1 == ventanas.len() {
            println!("   {:>3}/{} · {:<16} · {filas} filas · cortesía {}ms · {:?}",
                i + 1, ventanas.len(), v.etiqueta, http.cortesia_ms(), t0.elapsed());
        }
    }
    if fallidas > 0 { println!("   {fallidas} tramos sin leer, reintentables al reanudar"); }
    println!("   censadas {filas} filas, {cuerpos} cuerpos, {anom} anomalías en {:?}", t0.elapsed());

    // El eje de secciones tiene que ser una taxonomía cuyos nombres se hayan
    // descargado; las omitidas por tamaño darían un reparto vacío.
    let usables = db.taxonomias_con_nombres(conn_id)?;
    let elegida = usables.first().map(|(t, _)| t.clone());
    println!("taxonomías usables {usables:?} · eje elegido {elegida:?}");
    let tax0 = elegida.as_deref();
    let p = perfil::perfil(&db, conn_id, tax0)?;
    println!("\n══ PERFIL ═══════════════════════════════════");
    println!("censado          {}", p.censado);
    println!("rango            {:?}—{:?}", p.anio_min, p.anio_max);
    println!("sin fecha        {}", p.sin_fecha);
    println!("anomalías        {:?}", p.anomalias);
    let primeros: Vec<String> = p.por_anio.iter().take(6).map(|a| format!("{}:{}", a.anio, a.n)).collect();
    let ultimos: Vec<String> = p.por_anio.iter().rev().take(4).map(|a| format!("{}:{}", a.anio, a.n)).collect();
    println!("por año          {} … {}", primeros.join(" "), ultimos.join(" "));
    println!("secciones top    {:?}",
        p.secciones.iter().take(6).map(|s| format!("{}={}", s.nombre, s.n)).collect::<Vec<_>>());
    if let Some(s) = &p.sondeo {
        println!("sondeo n={}      p50={} palabras · p90={}", s.n, s.palabras_p50, s.palabras_p90);
        println!("  bloques {:.0}% · cortas {:.0}% · roto {:.0}%", s.pct_bloques, s.pct_cortas, s.pct_roto);
        println!("  shortcodes     {:?}", s.shortcodes);
    }
    println!("\n══ HALLAZGOS ════════════════════════════════");
    for h in perfil::hallazgos(&db, conn_id)? {
        println!("[{}] {} · {}{}", if h.bloquea { "▲" } else { "·" }, h.titulo, h.conteo,
            if h.estimado { " (estimado)" } else { "" });
        for (a, b) in h.ejemplos.iter().take(2) {
            println!("      {} — {}", &a[..a.len().min(58)], b);
        }
    }
    println!("\ntotal {:?}", t0.elapsed());
    Ok(())
}
