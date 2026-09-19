export interface MonteCarloPremisesDto {
  preco_venda?: number;
  tma_mensal?: number;
  folga_estoque?: number;
  horizonte_meses?: number;
  preco_referencia?: number;
  demanda_referencia?: number;
  elasticidade?: number;
  custo_usd?: number;
  frete_usd_unidade?: number;
  imposto_importacao?: number;
  cambio_base?: number;
  marketing_inicial?: number;
  comissao_marketplace?: number;
  imposto_venda?: number;
  frete_cliente?: number;
  custo_fixo_mensal?: number;
  lead_time_dias?: number;
  fracao_salvage?: number;
  curva_rampa?: number[];
  vol_cambio?: number;
  vol_preco?: number;
  vol_demanda?: number;
  vol_lead?: number;
  corr_cambio_lead?: number;
  qtd_minima_pedido?: number;
}

export interface RunMonteCarloDto {
  premises?: MonteCarloPremisesDto;
  scenario_count?: number;
  seed?: number;
  price_scan?: boolean;
  price_scan_scenarios?: number;
  offer_key?: string;
}

export interface RunMonteCarloBatchDto {
  limit?: number;
}

export interface FillMonteCarloPremisesWithAiDto {
  premises?: MonteCarloPremisesDto;
  user_notes?: string;
}
