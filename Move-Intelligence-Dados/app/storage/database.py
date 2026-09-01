import os
import yaml
from sqlalchemy import create_engine, Column, String, Float, Integer, Boolean, DateTime, ForeignKey, text
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime

Base = declarative_base()

# Carrega a string de conexao das configuracoes
def get_database_url():
    config_path = os.path.join(os.path.dirname(__file__), '../../configs/sources.yml')
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
            return config.get('database', {}).get('connection_string', 'sqlite:///data/processed/database.db')
    return 'sqlite:///data/processed/database.db'

# Certifica-se de que a pasta de destino do SQLite existe
db_url = get_database_url()
if db_url.startswith("sqlite:///"):
    db_file_path = db_url.replace("sqlite:///", "")
    db_dir = os.path.dirname(db_file_path)
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class RawRecordModel(Base):
    __tablename__ = 'raw_records'
    id = Column(String, primary_key=True)
    source = Column(String, nullable=False)
    endpoint = Column(String, nullable=False)
    query_params = Column(String)
    payload = Column(String, nullable=False)
    collected_at = Column(DateTime, default=datetime.utcnow)

class SupplierModel(Base):
    __tablename__ = 'suppliers'
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    website = Column(String)
    contact_info = Column(String)
    rating = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

class ProductModel(Base):
    __tablename__ = 'products'
    id = Column(String, primary_key=True)
    title = Column(String, nullable=False)
    sku = Column(String, unique=True)
    description = Column(String)
    category = Column(String)
    average_price = Column(Float, default=0.0)
    base_cost = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    listings = relationship("ListingModel", back_populates="product")

class ListingModel(Base):
    __tablename__ = 'listings'
    id = Column(String, primary_key=True)
    source_name = Column(String, nullable=False)
    source_id = Column(String, nullable=False)
    title = Column(String, nullable=False)
    url = Column(String, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String, nullable=False, default='BRL')
    availability = Column(Boolean, default=True)
    rating = Column(Float)
    reviews_count = Column(Integer, default=0)
    raw_record_id = Column(String, ForeignKey('raw_records.id', ondelete='SET NULL'))
    product_id = Column(String, ForeignKey('products.id', ondelete='SET NULL'))
    collected_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("ProductModel", back_populates="listings")

class TrendSignalModel(Base):
    __tablename__ = 'trend_signals'
    id = Column(String, primary_key=True)
    keyword = Column(String, nullable=False)
    source = Column(String, nullable=False, default='google_trends')
    timeframe = Column(String)
    interest_value = Column(Integer, nullable=False)
    collected_at = Column(DateTime, default=datetime.utcnow)

def init_db():
    # Cria todas as tabelas mapeadas se elas nao existirem
    Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
