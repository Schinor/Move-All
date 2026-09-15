/**
 * Câmbio padrão USD/BRL (F1.7). Fallback ÚNICO e documentado quando
 * `exchange_rates` não tem cotação: `usdBrlExchangeContext`, `seriesPoints`
 * e Unit Economics lêem a MESMA função/constante — sem fallbacks divergentes
 * 5,45/5,5/5,0. Valor de referência operacional; a fonte diária é a PTAX do
 * Banco Central (job `exchange-rates`, decisão D5 pendente).
 */
export const DEFAULT_FX_USD_BRL = 5.45;

/**
 * Paridade padrão CNY→USD (F2.4): só usada para converter custo 1688 quando
 * `exchange_rates` não tem o par (a origem vai para as premissas como
 * 'default'). Com cotação, usa-se (CNY/BRL) ÷ (USD/BRL) da PTAX.
 */
export const DEFAULT_FX_CNY_USD = 0.14;
