from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class RawRecordSchema(BaseModel):
    id: str = Field(..., description="UUID único do registro bruto")
    source: str = Field(..., description="Nome do conector ou scraper")
    endpoint: str = Field(..., description="URL ou endpoint de origem")
    query_params: Optional[str] = Field(None, description="Parâmetros de consulta serializados em JSON")
    payload: str = Field(..., description="Payload bruto retornado (JSON ou HTML)")
    collected_at: datetime = Field(default_factory=datetime.utcnow, description="Data e hora da coleta")

    class Config:
        from_attributes = True
