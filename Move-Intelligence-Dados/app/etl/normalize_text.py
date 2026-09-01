import re
import html

def clean_text(text_val: str, lowercase: bool = True) -> str:
    """
    Limpa e normaliza campos de texto: decodifica entidades HTML, remove espacos extras
    e caracteres nao textuais indesejados.
    """
    if not text_val:
        return ""
        
    # Decodifica entidades HTML (ex: &amp; -> &)
    text_val = html.unescape(text_val)
    
    # Remove tags HTML remanescentes
    text_val = re.sub(r'<[^>]*>', '', text_val)
    
    # Remove espacos em branco multiplos, quebras de linha e tabs
    text_val = re.sub(r'\s+', ' ', text_val)
    
    text_val = text_val.strip()
    
    if lowercase:
        text_val = text_val.lower()
        
    return text_val
