"""Alembic environment — legge DATABASE_URL da .env e usa i modelli SQLAlchemy."""

import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context
from dotenv import load_dotenv

# Aggiunge backend/ al path in modo che 'app' sia importabile
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))

# Importa Base e tutti i modelli per la autogenerate
from app.database import Base  # noqa: E402
import app.models.revenue  # noqa: E402, F401  — registra Hotel, HotelSeason, DailyRevenue

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Sovrascrive sqlalchemy.url con il valore da .env (ha precedenza su alembic.ini)
config.set_main_option(
    "sqlalchemy.url",
    os.environ["DATABASE_URL"].replace("%", "%%"),
)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
