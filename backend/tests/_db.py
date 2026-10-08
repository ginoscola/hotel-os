"""URL del database di test, unica sorgente per tutti i test di integrazione.

Letto da TEST_DATABASE_URL in backend/.env. I fixture dei test fanno TRUNCATE/drop_all:
rifiuta di partire se l'URL manca, coincide con DATABASE_URL o il nome DB non finisce in "_test".
"""
import os

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

TEST_DB_URL = os.getenv("TEST_DATABASE_URL", "")

_nome_db = TEST_DB_URL.rsplit("/", 1)[-1].split("?", 1)[0]
if not TEST_DB_URL or TEST_DB_URL == os.getenv("DATABASE_URL") or not _nome_db.endswith("_test"):
    raise RuntimeError(
        "TEST_DATABASE_URL mancante o non sicuro in backend/.env "
        "(deve puntare a un database dedicato il cui nome finisce in '_test', mai a quello reale)"
    )
