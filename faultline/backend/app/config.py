from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    surreal_url: str = "ws://localhost:8000/rpc"
    surreal_user: str = "root"
    surreal_pass: str = "root"
    surreal_ns: str = "faultline"
    surreal_db: str = "faultline"
    anthropic_api_key: str = ""
    opik_api_key: str = ""
    opik_workspace: str = ""
    opik_project_name: str = "faultline"
    langchain_tracing_v2: bool = True
    langchain_api_key: str = ""
    langchain_project: str = "faultline"
    rate_limit_requests_per_hour: int = 20
    rate_limit_tokens_per_hour: int = 100000

    class Config:
        env_file = ".env"


settings = Settings()
