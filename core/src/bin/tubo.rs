//! Recorre el tubo entero contra el archivo real: alcance → lote → tandas de
//! descarga y extracción → base de datos → calibración.
//!
//! Es la comprobación que la ventana no puede dar: que las ocho etapas encajan
//! sobre datos de verdad y que lo extraído queda donde la revisión lo busca.
use legajo_core::{alcance, contenido, census, extraccion, Auth, Db, Http};

#[tokio::main(flavor = "multi_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ruta = std::path::PathBuf::from(std::env::var("HOME")?)
        .join(".local/share/com.legajo.app/legajo.sqlite");
    let db = Db::open(&ruta)?;
    let http = Http::new()?;
    let conn_id = 1i64;

    // Cuántos artículos calibrar: pocos, porque el humano los revisa uno a uno.
    let n_cal: i64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(4);

    // 1 · Alcance. «Quién es quién» es denso en personas y organizaciones, que
    // es justo donde el extractor se juega su utilidad.
    let terminos = alcance::expandir(&db, conn_id, "categories", &[5027])?;
    let al = alcance::Alcance {
        taxonomia: "categories".into(), terminos,
        desde_anio: Some(2020), hasta_anio: Some(2026), incluir_sin_fecha: false,
    };
    let total = alcance::contar(&db, conn_id, &al)?;
    println!("1 · alcance      {total} artículos en el subárbol");

    let lote_id = alcance::crear_lote(&db, conn_id, "ensayo del tubo", &al, n_cal)?;
    let (_, en_lote) = db.avance_extraccion(lote_id, false, &[])?;
    println!("2 · lote {lote_id}       {en_lote} artículos, {n_cal} para calibrar");

    // 2 · El extractor: un solo proceso con el modelo. Se arranca antes
    //     de bajar nada, igual que en la app: si los modelos no cargan, no
    //     tiene sentido haber descargado cuerpos.
    let (python, guion) = extraccion::localizar(&extraccion::Rutas::del_repo())?;
    let mut sc = extraccion::Sidecar::iniciar(&python, &guion).await?;
    let modelos = extraccion::Modelos::default();
    let ms = sc.cargar(&modelos).await?;
    println!("3 · modelo       {} · spaCy {} · relaciones {} · {:.1}s",
             modelos.gliner, modelos.spacy,
             if sc.relaciones_activas { "sí" } else { "NO" }, ms as f64 / 1000.0);

    // 3 · Descarga y extracción en el mismo bucle, por tandas. Es lo que corre
    //     la app: una petición trae la tanda y el extractor la consume acto
    //     seguido, en vez de bajar el lote entero y luego recorrerlo otra vez.
    let cal = db.calibracion(lote_id)?.unwrap_or_default();
    let predicados = extraccion::predicados_modelo();
    let t = db.transporte(conn_id)?;
    let pendientes = db.pendientes_del_lote(lote_id, true, &[])?;
    println!("4 · extracción   {} artículos en tandas de {}",
             pendientes.len(), census::POR_TANDA);

    let (mut ents_tot, mut rels_tot, mut ms_tot) = (0i64, 0i64, 0u64);
    let mut hechos = 0usize;
    for tanda in pendientes.chunks(census::POR_TANDA) {
        let faltan = db.sin_cuerpo(conn_id, tanda)?;
        if !faltan.is_empty() {
            let cuerpos = census::traer_contenido(&http, &t, &Auth::None, &faltan).await?;
            let filas: Vec<_> = cuerpos.into_iter()
                .map(|(id, html)| { let l = contenido::limpiar(&html); (id, html, l) })
                .collect();
            db.guardar_articulos(conn_id, &filas)?;
            println!("     tanda de {}: {} cuerpos bajados", tanda.len(), filas.len());
        }

        for (wp_id, texto) in db.textos_de(conn_id, tanda)? {
            let parrafos: Vec<String> = texto.split("\n\n")
                .filter(|p| !p.trim().is_empty()).map(String::from).collect();
            match sc.procesar(wp_id, &parrafos, &cal.umbrales, &predicados, 0.4).await {
                Ok((ents, rels, ms)) => {
                    let n = db.guardar_extraidas(lote_id, wp_id, &ents)?;
                    let nr = db.guardar_relaciones_extraidas(lote_id, wp_id, &rels)?;
                    db.marcar_extraidos(lote_id, &[wp_id])?;
                    ents_tot += n; rels_tot += nr; ms_tot += ms; hechos += 1;
                    println!("     {wp_id}  {:>3} par · {n:>3} ent · {nr:>2} rel · {ms} ms",
                             parrafos.len());
                }
                Err(e) => println!("     {wp_id}  falló: {e}"),
            }
        }
    }
    sc.cerrar().await;

    let por_art = if hechos == 0 { 0 } else { ms_tot as usize / hechos };
    println!("\n   {ents_tot} entidades · {rels_tot} relaciones · {por_art} ms/artículo");
    println!("   el archivo entero: {:.1} h", total as f64 * por_art as f64 / 3_600_000.0);

    // 4 · Lo que la revisión va a encontrar servido.
    println!("\n6 · muestra de lo extraído");
    db.con(|c| {
        let mut st = c.prepare(
            "SELECT etiqueta, COUNT(*), ROUND(AVG(score),2), ROUND(MIN(score),2), ROUND(MAX(score),2)
             FROM extraidas WHERE lote_id = ?1 GROUP BY etiqueta ORDER BY 2 DESC")?;
        let filas = st.query_map([lote_id], |r| Ok((
            r.get::<_, String>(0)?, r.get::<_, i64>(1)?,
            r.get::<_, f64>(2)?, r.get::<_, f64>(3)?, r.get::<_, f64>(4)?)))?;
        for f in filas.flatten() {
            println!("     {:<14} {:>3}   media {:.2}  ({:.2}—{:.2})", f.0, f.1, f.2, f.3, f.4);
        }
        let mut st = c.prepare(
            "SELECT predicado, COUNT(*) FROM relaciones_extraidas
             WHERE lote_id = ?1 GROUP BY predicado ORDER BY 2 DESC")?;
        for f in st.query_map([lote_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.flatten() {
            println!("     rel {:<10} {:>3}", f.0, f.1);
        }
        Ok(())
    })?;

    println!("\n   lote {lote_id} listo para revisar en la app");
    Ok(())
}
