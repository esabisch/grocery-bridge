from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    todoist_api_token: str = Field(default="")
    todoist_project_name: str = "Groceries"

    walmart_list_name: str = "Weekly Groceries"
    browser_profile_dir: Path = Path("./data/browser_profile")
    sku_map_path: Path = Path("./data/sku_map.json")

    dev_user_email: str = ""
    log_level: str = "INFO"


settings = Settings()
