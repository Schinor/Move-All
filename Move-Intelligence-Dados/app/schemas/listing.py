from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class ListingSchema(BaseModel):
    id: str = Field(..., description="ID gerado internamente para o anúncio")
    source_name: str = Field(..., description="Nome da plataforma, ex: mercado_livre")
    source_id: str = Field(..., description="ID original da listagem na plataforma de origem")
    title: str = Field(..., description="Título do anúncio")
    url: str = Field(..., description="Link do anúncio original")
    price: float = Field(..., description="Preço numérico do produto no anúncio")
    currency: str = Field("BRL", description="Moeda em formato ISO de 3 letras")
    availability: bool = Field(True, description="Indicação se o produto está em estoque")
    rating: Optional[float] = Field(None, description="Classificação do produto no anúncio")
    reviews_count: int = Field(0, description="Número de reviews/avaliações no anúncio")
    raw_record_id: Optional[str] = Field(None, description="FK para o registro bruto de origem")
    product_id: Optional[str] = Field(None, description="FK para o produto consolidado após resolução")
    collected_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        from_attributes = True
