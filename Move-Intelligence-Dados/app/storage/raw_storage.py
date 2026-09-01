import os
import logging

# Define a pasta raiz de dados do projeto de forma segura
DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../data'))
RAW_DIR = os.path.join(DATA_DIR, 'raw')

# Garante que a pasta raw existe
os.makedirs(RAW_DIR, exist_ok=True)

def save_raw_payload(filename: str, payload: str, subfolder: str = "") -> str:
    """
    Salva uma resposta bruta (HTML ou JSON) em disco sob a pasta 'data/raw/'.
    Implementa controles rígidos contra Path Traversal (CWE-22).
    """
    # 1. Sanitizar subpasta e nome do arquivo usando basename
    clean_subfolder = os.path.basename(subfolder) if subfolder else ""
    clean_filename = os.path.basename(filename)

    # 2. Construir o caminho de destino
    target_dir = os.path.abspath(os.path.join(RAW_DIR, clean_subfolder))
    target_path = os.path.abspath(os.path.join(target_dir, clean_filename))

    # 3. Validar barreira do diretório (Princípio de sandbox de arquivos)
    # Garante que a pasta de gravação resultante está sob RAW_DIR
    if not target_path.startswith(RAW_DIR + os.sep) and target_path != RAW_DIR:
        logging.error(f"Tentativa de path traversal bloqueada. Caminho final gerado: {target_path}")
        raise ValueError("Operação de arquivo inválida (tentativa de Path Traversal).")

    # 4. Criar subpasta caso não exista
    os.makedirs(target_dir, exist_ok=True)

    # 5. Salvar o payload
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(payload)

    return target_path

def read_raw_payload(filename: str, subfolder: str = "") -> str:
    """
    Lê uma resposta bruta do disco sob a pasta 'data/raw/'.
    Implementa controles contra Path Traversal.
    """
    clean_subfolder = os.path.basename(subfolder) if subfolder else ""
    clean_filename = os.path.basename(filename)

    target_path = os.path.abspath(os.path.join(RAW_DIR, clean_subfolder, clean_filename))

    if not target_path.startswith(RAW_DIR + os.sep) and target_path != RAW_DIR:
        logging.error(f"Tentativa de path traversal bloqueada na leitura. Caminho: {target_path}")
        raise ValueError("Operação de leitura inválida (tentativa de Path Traversal).")

    if not os.path.exists(target_path):
        raise FileNotFoundError(f"Arquivo de coleta bruta não encontrado em: {target_path}")

    with open(target_path, "r", encoding="utf-8") as f:
        return f.read()
