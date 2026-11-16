import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Base configuration."""
    SECRET_KEY = os.getenv("SECRET_KEY")
    MONGO_URI = os.getenv("MONGO_URI")
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB max upload
    MATA_API_BASE_URL = os.getenv("MATA_API_BASE_URL")
    MATA_VEHICLES_PATH = os.getenv("MATA_VEHICLES_PATH")
    MATA_LIGNES = os.getenv("MATA_LIGNES")
    # Demo mode: serve bundled mock_vehicles.json instead of the real feed.
    # Off unless explicitly enabled; responses are labelled source="mock".
    USE_MOCK_VEHICLES = os.getenv("USE_MOCK_VEHICLES", "").strip().lower() in ("1", "true", "yes")
    DEBUG = False
    TESTING = False


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


class TestingConfig(Config):
    TESTING = True
    MONGO_URI = os.getenv("MONGO_URI_TEST")


config = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
    "default": DevelopmentConfig,
}
