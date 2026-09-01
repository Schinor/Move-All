from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class ProductSchema(BaseModel):
    id: str = Field(..., description="UUID do produto consolidado")
    title: str = Field(..., description="Nome de referência do produto unificado")
    sku: Optional[str] = Field(None, description="SKU padrão de referência do produto")
    description: Optional[str] = Field(None, description="Descrição detalhada consolidada")
    category: Optional[str] = Field(None, description="Categoria do produto")
    average_price: float = Field(0.0, description="Preço médio de mercado calculado")
    base_cost: float = Field(0.0, description="Preço de custo padrão estimado")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        from_attributes = True
