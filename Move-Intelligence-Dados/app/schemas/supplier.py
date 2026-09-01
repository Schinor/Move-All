from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional

class SupplierSchema(BaseModel):
    id: str = Field(..., description="ID ou SKU exclusivo do fornecedor")
    name: str = Field(..., description="Nome comercial da empresa/fornecedor")
    website: Optional[str] = Field(None, description="Endereço eletrônico do fornecedor")
    contact_info: Optional[str] = Field(None, description="Informações de e-mail, telefone ou chat")
    rating: Optional[float] = Field(None, description="Avaliação/Score de confiança do fornecedor")
    created_at: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        from_attributes = True
