"""Módulo de Resiliência e Circuit Breaker para Conectores e Scrapers.

Implementa o padrão Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN), retries
com backoff exponencial e detecção de bloqueios (Cloudflare, Captcha, HTTP 429).
"""

from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass, field
from enum import Enum
from functools import wraps
from typing import Any, Callable, Dict, Optional, TypeVar

LOGGER = logging.getLogger("CircuitBreaker")

T = TypeVar("T")


class CircuitState(str, Enum):
    CLOSED = "CLOSED"      # Operação normal, requisições permitidas
    OPEN = "OPEN"          # Bloqueado, requisições falham imediatamente
    HALF_OPEN = "HALF_OPEN"# Testando recuperação com requisição de sonda


class CircuitBreakerOpenException(Exception):
    """Exceção levantada quando o circuito do conector está aberto."""
    pass


@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = 4
    recovery_timeout: float = 60.0  # segundos antes de tentar HALF_OPEN
    half_open_success_threshold: int = 2
    state: CircuitState = CircuitState.CLOSED
    failure_count: int = 0
    success_count: int = 0
    total_calls: int = 0
    total_failures: int = 0
    last_failure_time: Optional[float] = None
    last_error_message: Optional[str] = None

    def can_execute(self) -> bool:
        """Verifica se uma requisição pode prosseguir."""
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            if self.last_failure_time and (time.time() - self.last_failure_time) >= self.recovery_timeout:
                LOGGER.info("[%s] Tempo de recuperação atingido. Mudando para HALF_OPEN...", self.name)
                self.state = CircuitState.HALF_OPEN
                self.success_count = 0
                return True
            return False

        if self.state == CircuitState.HALF_OPEN:
            return True

        return False

    def record_success(self) -> None:
        """Registra uma chamada bem-sucedida."""
        self.total_calls += 1
        if self.state == CircuitState.HALF_OPEN:
            self.success_count += 1
            if self.success_count >= self.half_open_success_threshold:
                LOGGER.info("[%s] Circuito recuperado com sucesso. Retornando para CLOSED.", self.name)
                self.state = CircuitState.CLOSED
                self.failure_count = 0
        elif self.state == CircuitState.CLOSED:
            self.failure_count = 0

    def record_failure(self, error: Exception) -> None:
        """Registra uma falha e atualiza o estado do circuito."""
        self.total_calls += 1
        self.total_failures += 1
        self.failure_count += 1
        self.last_failure_time = time.time()
        self.last_error_message = str(error)

        LOGGER.warning(
            "[%s] Falha registrada (%d/%d): %s",
            self.name,
            self.failure_count,
            self.failure_threshold,
            error,
        )

        if self.state == CircuitState.HALF_OPEN or self.failure_count >= self.failure_threshold:
            LOGGER.error(
                "[%s] Limite de falhas atingido. Abrindo circuito por %.0fs.",
                self.name,
                self.recovery_timeout,
            )
            self.state = CircuitState.OPEN

    def get_health_stats(self) -> Dict[str, Any]:
        """Retorna métricas de saúde do conector."""
        success_rate = (
            ((self.total_calls - self.total_failures) / self.total_calls * 100)
            if self.total_calls > 0
            else 100.0
        )
        return {
            "name": self.name,
            "state": self.state.value,
            "success_rate_pct": round(success_rate, 1),
            "total_calls": self.total_calls,
            "total_failures": self.total_failures,
            "consecutive_failures": self.failure_count,
            "last_error": self.last_error_message,
        }


# Registro global de Circuit Breakers por fonte
REGISTRY: Dict[str, CircuitBreaker] = {}


def get_circuit_breaker(name: str, **kwargs) -> CircuitBreaker:
    if name not in REGISTRY:
        REGISTRY[name] = CircuitBreaker(name=name, **kwargs)
    return REGISTRY[name]


def is_block_or_captcha(error_text: str) -> bool:
    """Detecta indícios de bloqueio por Cloudflare, Captcha ou Rate Limiting."""
    lowered = error_text.lower()
    indicators = [
        "cloudflare",
        "captcha",
        "access denied",
        "rate limit",
        "too many requests",
        "429",
        "403 forbidden",
        "waf",
        "datadome",
        "perimeterx",
    ]
    return any(ind in lowered for ind in indicators)


def retry_with_backoff(
    connector_name: str,
    max_retries: int = 3,
    base_delay: float = 1.5,
    max_delay: float = 12.0,
):
    """Decorator para executar chamadas com Circuit Breaker e backoff exponencial."""
    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        def wrapper(*args, **kwargs) -> T:
            breaker = get_circuit_breaker(connector_name)
            if not breaker.can_execute():
                raise CircuitBreakerOpenException(
                    f"Conector '{connector_name}' temporariamente suspenso pelo Circuit Breaker (Estado: {breaker.state.value})."
                )

            last_err: Optional[Exception] = None
            for attempt in range(1, max_retries + 1):
                try:
                    result = fn(*args, **kwargs)
                    breaker.record_success()
                    return result
                except Exception as exc:
                    last_err = exc
                    if is_block_or_captcha(str(exc)):
                        LOGGER.warning("[%s] Bloqueio ou desafio anti-bot detectado na tentativa %d: %s", connector_name, attempt, exc)

                    if attempt < max_retries:
                        # Backoff com jitter aleatório
                        delay = min(max_delay, base_delay * (2 ** (attempt - 1)) + random.uniform(0.1, 0.9))
                        LOGGER.info("[%s] Tentativa %d falhou. Aguardando %.2fs para retentar...", connector_name, attempt, delay)
                        time.sleep(delay)

            breaker.record_failure(last_err or Exception("Erro desconhecido"))
            raise last_err or Exception(f"Falha persistente no conector {connector_name}")

        return wrapper
    return decorator


__all__ = [
    "CircuitBreaker",
    "CircuitBreakerOpenException",
    "CircuitState",
    "REGISTRY",
    "get_circuit_breaker",
    "is_block_or_captcha",
    "retry_with_backoff",
]
