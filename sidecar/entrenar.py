#!/usr/bin/env python3
"""Afina GLiNER-relex sobre el patrón exportado.

Paso 6.2 de docs/plan-entrenamiento.md. Parte del checkpoint multilingüe,
entrena N épocas con tasas distintas para el codificador y las cabezas, *focal
loss* en tramos y relaciones, y guarda un checkpoint por época con su config,
los hashes de los datos y las métricas de pérdida. La evaluación por tipo y
predicado la hace aparte `banco_relaciones.py` sobre cada checkpoint.

    .venv/bin/python sidecar/entrenar.py --datos sidecar/entrenamiento/v1 --lr 1e-5 --epocas 4
"""
import argparse
import hashlib
import json
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))


def leer(ruta):
    return [json.loads(l) for l in open(ruta, encoding="utf-8")]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", required=True, help="directorio con train.jsonl y val.jsonl")
    ap.add_argument("--base", default="knowledgator/gliner-relex-multi-v1.0")
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--lr-cabezas", type=float, default=5e-5)
    ap.add_argument("--epocas", type=int, default=4)
    ap.add_argument("--lote", type=int, default=8)
    ap.add_argument("--acumulacion", type=int, default=1)
    ap.add_argument("--max-types", type=int, default=45)
    ap.add_argument("--semilla", type=int, default=42)
    ap.add_argument("--salida", default=None)
    ap.add_argument("--pasos-max", type=int, default=None, help="cortar a N pasos (para medir velocidad)")
    ap.add_argument("--dispositivo", default=None, help="cuda | mps | cpu (por defecto, el mejor disponible)")
    ap.add_argument("--congelar-mitad", action="store_true", help="congela la mitad baja del codificador (contra el olvido)")
    args = ap.parse_args()

    import os
    # En MPS el asignador cachea bloques de cada forma de lote y, con secuencias
    # de largo variable, crece hasta ocupar toda la memoria unificada (16 GB
    # medidos); el sistema empieza a paginar y el paso pasa de 1 s a 11 s. Tope
    # al 60 % y vaciar la caché cada pocos pasos lo mantiene a raya.
    os.environ.setdefault("PYTORCH_MPS_HIGH_WATERMARK_RATIO", "0.75")
    os.environ.setdefault("PYTORCH_MPS_LOW_WATERMARK_RATIO", "0.6")
    import torch
    from gliner import GLiNER
    from gliner.training import Trainer, TrainingArguments
    from transformers import TrainerCallback

    class VaciarCacheMPS(TrainerCallback):
        def __init__(self, cada=10):
            self.cada = cada

        def on_step_end(self, args, state, control, **kwargs):
            if state.global_step % self.cada == 0 and torch.backends.mps.is_available():
                torch.mps.empty_cache()
            return control

    datos = pathlib.Path(args.datos)
    train, val = leer(datos / "train.jsonl"), leer(datos / "val.jsonl")
    hashes = {c: hashlib.sha256((datos / f"{c}.jsonl").read_bytes()).hexdigest() for c in ("train", "val")}
    fecha = time.strftime("%Y%m%d-%H%M")
    salida = pathlib.Path(args.salida or (pathlib.Path(__file__).parent / "entrenamiento" / f"{fecha}-lr{args.lr:g}"))
    salida.mkdir(parents=True, exist_ok=True)
    print(f"{len(train)} ejemplos de entrenamiento · {len(val)} de validación → {salida}", file=sys.stderr)

    torch.manual_seed(args.semilla)
    dispositivo = args.dispositivo or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    import gliner.data_processing.processor as _proc
    if "Legajo: squeeze(-1)" not in pathlib.Path(_proc.__file__).read_text():
        sys.exit("gliner sin el parche de Legajo en create_relation_labels (un lote donde todos los ejemplos tienen "
                 "una sola entidad rompe con «Value after * must be an iterable»); ver entrenamiento/README.md")
    modelo = GLiNER.from_pretrained(args.base)
    # Con 35 predicados más negativos muestreados por ejemplo, el tope de tipos
    # del modelo (25) truncaría al azar: se sube antes de entrenar.
    if hasattr(modelo.config, "max_types") and modelo.config.max_types < args.max_types:
        modelo.config.max_types = args.max_types
    modelo.to(dispositivo)
    # La matriz de vocabulario de mDeBERTa (250k × 768 = 192M parámetros, 736 MB)
    # no tiene nada que aprender de 1.500 párrafos y, con Adam, cuesta 4 copias
    # de sí misma en memoria: era lo que reventaba el paso del optimizador en MPS.
    congeladas = 0
    for n, p in modelo.named_parameters():
        if "word_embeddings" in n:
            p.requires_grad_(False); congeladas += p.numel()
    print(f"embeddings de vocabulario congelados: {congeladas / 1e6:.0f}M parámetros", file=sys.stderr)
    if args.congelar_mitad:
        capas = [m for n, m in modelo.model.named_modules() if n.endswith("encoder.layer") or n.endswith("encoder.layers")]
        for c in capas:
            for i, capa in enumerate(c):
                if i < len(c) // 2:
                    for p in capa.parameters():
                        p.requires_grad = False

    pasos_por_epoca = max(1, len(train) // (args.lote * args.acumulacion))
    argumentos = TrainingArguments(
        output_dir=str(salida),
        learning_rate=args.lr, weight_decay=0.01,
        others_lr=args.lr_cabezas, others_weight_decay=0.01,
        focal_loss_alpha=0.75, focal_loss_gamma=2.0,
        rel_focal_loss_alpha=0.75, rel_focal_loss_gamma=2.0,
        lr_scheduler_type="linear", warmup_ratio=0.1,
        per_device_train_batch_size=args.lote, per_device_eval_batch_size=args.lote,
        gradient_accumulation_steps=args.acumulacion,
        num_train_epochs=args.epocas, max_steps=args.pasos_max or pasos_por_epoca * args.epocas,
        disable_tqdm=True,
        eval_strategy="epoch", save_strategy="epoch", save_total_limit=args.epocas,
        logging_steps=max(1, pasos_por_epoca // 10), report_to="none",
        bf16=(dispositivo == "cuda"), use_cpu=(dispositivo == "cpu"),
        dataloader_num_workers=0, seed=args.semilla, negatives=1.0,
        remove_unused_columns=False,
    )
    (salida / "args.json").write_text(json.dumps({**vars(args), "dispositivo": dispositivo, "hashes": hashes,
                                                   "pasos_por_epoca": pasos_por_epoca, "gliner": __import__("gliner").__version__},
                                                  indent=1, default=str))
    import transformers
    from packaging import version
    tok = modelo.data_processor.transformer_tokenizer
    extra = {"processing_class": tok} if version.parse(transformers.__version__) >= version.parse("5.0.0") else {"tokenizer": tok}
    trainer = Trainer(
        model=modelo, args=argumentos,
        train_dataset=train, eval_dataset=val,
        data_collator=modelo._create_data_collator(),
        callbacks=[VaciarCacheMPS()] if dispositivo == "mps" else [],
        **extra,
    )
    t0 = time.time()
    trainer.train()
    modelo.save_pretrained(str(salida / "final"))
    metricas = [x for x in trainer.state.log_history]
    (salida / "metrics.jsonl").write_text("\n".join(json.dumps(m) for m in metricas))
    print(f"entrenado en {(time.time() - t0) / 60:.1f} min → {salida / 'final'}", file=sys.stderr)


if __name__ == "__main__":
    main()
