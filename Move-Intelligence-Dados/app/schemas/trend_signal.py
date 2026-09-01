from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class TrendSignalSchema(BaseModel):
    id: str = Field(..., description="ID exclusivo do registro de tendência")
    keyword: str = Field(..., description="Termo de pesquisa analisado")
    source: str = Field("google_trends", description="Fonte de dados de tendência")
    timeframe: Optional[str] = Field(None, description="Período temporal da métrica")
    interest_value: int = Field(..., ge=0, le=100, description="Métrica de interesse relativo (0 a 100)")
    collected_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        from_attributes = True
