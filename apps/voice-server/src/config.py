from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Google Gemini
    google_api_key: str

    # Daily.co
    daily_api_key: str
    daily_domain: str

    # Twilio
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_phone_number: str

    # ShopMonkey
    shopmonkey_email: str
    shopmonkey_password: str
    shopmonkey_base_url: str = "https://api.shopmonkey.cloud/v3"

    # Database
    database_url: str

    # Dashboard webhook
    dashboard_webhook_url: str = "http://localhost:3000/api/webhooks/pipecat"
    pipecat_webhook_secret: str = "changeme"

    # Server
    host: str = "0.0.0.0"
    port: int = 7860

    # Shop info for SMS/prompts
    shop_name: str = "Smart Choice Auto Shop"
    human_transfer_number: str = ""  # E.164 number to transfer to a human


settings = Settings()
