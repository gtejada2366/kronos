# SENAMHI Scraper — Para correr en tu PC (Windows)

Descarga datos de las 971 estaciones activas de SENAMHI (2020-2026)
usando un browser visible que resuelve Cloudflare Turnstile automáticamente.

## Setup (una sola vez, 2 minutos)

1. Abre PowerShell o CMD
2. Instala dependencias:
```
pip install playwright requests beautifulsoup4 pandas
playwright install chromium
```

3. Copia esta carpeta completa a tu PC

## Uso

```
python scrape_all.py
```

Se abre Chrome visible. La primera vez puede pedirte resolver un captcha
(click en el checkbox). Después navega solo.

Para testear con pocas estaciones:
```
python scrape_all.py --max-stations 10
```

Para continuar una descarga interrumpida (salta las ya descargadas):
```
python scrape_all.py
```

## Output

Los datos se guardan en la carpeta `output/`:
- `output/XXXXXX_NOMBRE.csv` — un CSV por estación con todos los meses
- `output/_catalog.json` — catálogo de estaciones con meses disponibles
- `output/_progress.json` — progreso para resumir descargas

## Después de descargar

Copia la carpeta `output/` al NAS:
```
rclone copy output/ nas:Waterku/data_climate/raw/senamhi_active_full/
```
O simplemente copia los CSVs al NAS por la red local.
