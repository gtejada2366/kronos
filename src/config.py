"""Config loader."""
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:
    import tomli as tomllib

_CFG: dict | None = None
_PATH = Path(__file__).parent.parent / "config" / "settings.toml"


def load(path: Path | None = None) -> dict:
    global _CFG
    if _CFG is not None and path is None:
        return _CFG
    p = path or _PATH
    if not p.exists():
        raise FileNotFoundError(f"Config not found: {p}. Copy settings.example.toml → settings.toml")
    with open(p, "rb") as f:
        _CFG = tomllib.load(f)
    return _CFG


def get(section: str, key: str, default: Any = None) -> Any:
    return load().get(section, {}).get(key, default)
