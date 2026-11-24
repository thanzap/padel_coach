import os

# Settings are validated at import time; unit tests never touch the database or
# Supabase, so placeholders are enough (and keep CI free of secrets).
os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/test")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
