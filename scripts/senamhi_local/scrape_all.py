#!/usr/bin/env python3
"""
SENAMHI Full Station Scraper — runs on your local PC with visible browser.

Downloads daily precip + Tmax + Tmin for ALL available months from each
of SENAMHI's 971 active stations. Uses Playwright with visible Chrome
so Cloudflare Turnstile resolves automatically.

Usage:
    python scrape_all.py                    # all stations, all months
    python scrape_all.py --max-stations 10  # test with 10
    python scrape_all.py --types CO,EMA     # only specific types
"""

import argparse
import asyncio
import csv
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlencode

import requests

log = logging.getLogger("senamhi")

STATIONS_URL = "https://raw.githubusercontent.com/danyneyra/senamhi-scraper/main/data/estaciones.json"
BASE_URL = "https://www.senamhi.gob.pe/mapas/mapa-estaciones-2/map_red_graf.php"
IFRAME_URL = "https://www.senamhi.gob.pe/mapas/mapa-estaciones-2/__dt_est_tp_0s3n@mH1.php"
OUTPUT_DIR = Path("output")
PROGRESS_FILE = OUTPUT_DIR / "_progress.json"
CATALOG_FILE = OUTPUT_DIR / "_catalog.json"

# Station types with meteorological data (precip + temp)
MET_TYPES = ['CO', 'CP', 'PLU', 'MAP', 'EMA', 'EAMA', 'SUT']


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        return json.loads(PROGRESS_FILE.read_text())
    return {"completed": [], "failed": []}


def save_progress(progress: dict):
    PROGRESS_FILE.write_text(json.dumps(progress, indent=2))


def get_stations(types=None) -> list:
    """Download station catalog."""
    log.info("Downloading station catalog...")
    r = requests.get(STATIONS_URL, timeout=30)
    stations = r.json()

    if types:
        stations = [s for s in stations if s['cate'] in types]

    log.info("Stations: %d", len(stations))
    return stations


def parse_highcharts(content: str) -> dict | None:
    """Extract daily data from Highcharts embedded in page HTML."""
    cats = re.findall(r"categories:\s*\[(.*?)\]", content)
    datas = re.findall(r"data:\s*\[([\d\.\-,\s]+)\]", content)

    if not cats or len(datas) < 3:
        return None

    days = [d.strip().strip("'\"") for d in cats[0].split(',')]
    precip = [float(v.strip()) for v in datas[0].split(',') if v.strip()]
    tmax = [float(v.strip()) for v in datas[1].split(',') if v.strip()]
    tmin = [float(v.strip()) for v in datas[2].split(',') if v.strip()]

    n = min(len(days), len(precip), len(tmax), len(tmin))
    if n == 0:
        return None

    return {
        'days': days[:n],
        'precip': precip[:n],
        'tmax': tmax[:n],
        'tmin': tmin[:n],
    }


def parse_table_html(html: str) -> list[dict] | None:
    """Parse the data table from the iframe response."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')

    tables = soup.find_all('table')
    for table in tables:
        rows = table.find_all('tr')
        if len(rows) < 3:
            continue

        # Find header
        header_row = rows[0]
        headers = [c.get_text(strip=True).lower() for c in header_row.find_all(['td', 'th'])]

        if not any('dia' in h or 'fecha' in h or 'day' in h for h in headers):
            continue

        data_rows = []
        for row in rows[1:]:
            cells = [c.get_text(strip=True) for c in row.find_all(['td', 'th'])]
            if len(cells) >= 4 and cells[0].isdigit():
                try:
                    data_rows.append({
                        'day': int(cells[0]),
                        'tmax': float(cells[1]) if cells[1] and cells[1] != 'S/D' else None,
                        'tmin': float(cells[2]) if cells[2] and cells[2] != 'S/D' else None,
                        'precip': float(cells[3]) if cells[3] and cells[3] != 'S/D' else None,
                    })
                except (ValueError, IndexError):
                    pass

        if data_rows:
            return data_rows

    return None


async def scrape_station(page, station: dict, output_dir: Path) -> dict:
    """Scrape all available months for a single station."""
    cod = station['cod']
    nom = station['nom']
    safe_name = re.sub(r'[^\w\-]', '_', nom)
    out_file = output_dir / f"{cod}_{safe_name}.csv"

    params = {
        'cod': cod, 'estado': station['estado'],
        'tipo_esta': station['cate'], 'cate': station['cate'],
        'cod_old': station['cod_old'],
    }
    url = f"{BASE_URL}?{urlencode(params)}"

    # Load station page
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page.wait_for_timeout(4000)

    content = await page.content()

    # Get available months
    months = re.findall(r'<option[^>]*value="(\d{6})"', content)
    months = [m for m in months if m.isdigit() and len(m) == 6]

    if not months:
        return {'status': 'no_months', 'months': 0}

    # Get latest month from Highcharts (always available without Turnstile)
    latest_data = parse_highcharts(content)

    all_rows = []

    # Try to get Turnstile token for other months
    token = await page.evaluate('''() => {
        const input = document.querySelector('input[name="cf-turnstile-response"]');
        return input ? input.value : null;
    }''')

    if token and len(token) > 20:
        # We have a Turnstile token — can load ALL months via iframe
        for month_code in months:
            try:
                year = int(month_code[:4])
                month = int(month_code[4:])

                resp_html = await page.evaluate('''async (args) => {
                    const [token, cod, month, tipo, estado, cod_old, alt] = args;
                    const formData = new FormData();
                    formData.append('cf-turnstile-response', token);
                    formData.append('estaciones', cod);
                    formData.append('CBOFiltro', month);
                    formData.append('t_e', tipo);
                    formData.append('estado', estado);
                    formData.append('cod_old', cod_old);
                    formData.append('alt', alt || '');
                    const resp = await fetch(arguments[0], {method: 'POST', body: formData});
                    return await resp.text();
                }''', [token, cod, month_code, station['cate'],
                       station['estado'], station['cod_old'], ''],
                )

                table_data = parse_table_html(resp_html)
                if table_data:
                    for row in table_data:
                        all_rows.append({
                            'date': f"{year}-{month:02d}-{row['day']:02d}",
                            'precip_mm': row['precip'],
                            'tmax_c': row['tmax'],
                            'tmin_c': row['tmin'],
                        })

            except Exception:
                pass

    elif latest_data:
        # No token — only save the latest month from Highcharts
        for i in range(len(latest_data['days'])):
            all_rows.append({
                'date': latest_data['days'][i],
                'precip_mm': latest_data['precip'][i],
                'tmax_c': latest_data['tmax'][i],
                'tmin_c': latest_data['tmin'][i],
            })

    if not all_rows:
        return {'status': 'no_data', 'months': len(months)}

    # Save CSV
    with open(out_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'date', 'precip_mm', 'tmax_c', 'tmin_c',
            'station_id', 'station_name', 'lat', 'lon', 'category',
        ])
        writer.writeheader()
        for row in all_rows:
            row['station_id'] = cod
            row['station_name'] = nom
            row['lat'] = station['lat']
            row['lon'] = station['lon']
            row['category'] = station['cate']
            writer.writerow(row)

    months_got = len(set(r['date'][:7] for r in all_rows))
    return {
        'status': 'ok',
        'months_available': len(months),
        'months_downloaded': months_got,
        'days': len(all_rows),
        'month_range': f"{months[0]}-{months[-1]}",
    }


async def main_async(stations, max_stations=None):
    from playwright.async_api import async_playwright

    OUTPUT_DIR.mkdir(exist_ok=True)
    progress = load_progress()

    if max_stations:
        stations = stations[:max_stations]

    # Filter already completed
    todo = [s for s in stations if s['cod'] not in progress['completed']]
    log.info("To scrape: %d (already done: %d)", len(todo), len(progress['completed']))

    async with async_playwright() as p:
        # VISIBLE browser — Turnstile resolves automatically
        browser = await p.chromium.launch(
            headless=False,
            args=['--disable-blink-features=AutomationControlled'],
        )
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 800},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )
        page = await context.new_page()

        # Override webdriver detection
        await page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        """)

        t0 = time.time()
        downloaded = 0
        failed = 0

        for i, station in enumerate(todo):
            try:
                result = await scrape_station(page, station, OUTPUT_DIR)

                if result['status'] == 'ok':
                    downloaded += 1
                    progress['completed'].append(station['cod'])
                else:
                    failed += 1
                    progress['failed'].append(station['cod'])

            except Exception as e:
                failed += 1
                log.warning("Error %s: %s", station['nom'], str(e)[:50])

            # Save progress every 10 stations
            if (i + 1) % 10 == 0:
                save_progress(progress)
                elapsed = (time.time() - t0) / 60
                rate = elapsed / max(downloaded + failed, 1)
                eta = rate * (len(todo) - i - 1)
                log.info(
                    "[%d/%d] downloaded=%d failed=%d | %.0fm elapsed ~%.0fm ETA",
                    i + 1, len(todo), downloaded, failed, elapsed, eta,
                )

        save_progress(progress)
        await browser.close()

    return downloaded, failed


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )

    parser = argparse.ArgumentParser(description="SENAMHI Full Station Scraper")
    parser.add_argument("--max-stations", type=int, default=None)
    parser.add_argument("--types", type=str, default=None,
                        help="Comma-separated station types (default: all meteorological)")
    args = parser.parse_args()

    types = args.types.split(',') if args.types else MET_TYPES
    stations = get_stations(types)

    t0 = time.time()
    downloaded, failed = asyncio.run(main_async(stations, args.max_stations))

    elapsed = (time.time() - t0) / 60
    log.info("=" * 60)
    log.info("COMPLETED in %.0f min", elapsed)
    log.info("  Downloaded: %d", downloaded)
    log.info("  Failed:     %d", failed)
    log.info("  Output:     %s", OUTPUT_DIR)
    log.info("=" * 60)


if __name__ == "__main__":
    main()
