
  ### 1. 🔍 Por que os produtos estavam com score abaixo de 60?                                                                                  
                                                                                                                                                 
  No algoritmo original (trend-engine.service.ts), a fórmula ponderada do Trend Score divide o cálculo em 6 pilares de mercado:                  
                                                                                                                                                 
    Trend Score = ∑(Scoreᵢ × Pesoᵢ)                                                                                                              
                                                                                                                                                 
  • 📈 Marketplace Growth: peso 0.25 (25%)                                                                                                       
  • 💰 Price Opportunity: peso 0.20 (20%)                                                                                                        
  • ⭐ Review Velocity: peso 0.10 (10%)                                                                                                          
  • 🔍 Search Growth: peso 0.15 (15%) (estava gerando 0 nas snapshots de marketplace)                                                            
  • 🏭 Supplier Growth: peso 0.20 (20%) (estava gerando 0)                                                                                       
  • 📱 Social Buzz: peso 0.10 (10%) (estava gerando 0 para fontes não-chinesas)                                                                  
                                                                                                                                                 
  │ O motivo do teto em ~55 pontos:                                                                                                              
  │ Como os 3 últimos pilares somam 45% dos pesos, e estavam zerados nos snapshots de marketplace, a pontuação máxima teórica que qualquer       
  produto                                                                                                                                        
  │ conseguia atingir era de apenas 0.55 (55/100), mesmo com crescimentos reais superiores a +300% e centenas de milhares de vendas.             
                                                                                                                                                 
  #### 🛠️ Correção Aplicada:                                                                                                                     
                                                                                                                                                 
  Implementamos a normalização dinâmica pela soma dos pesos ativos:                                                                              
                                                                                                                                                 
                         ∑    (Scoreᵢ × Pesoᵢ)                                                                                                   
                       ativos                                                                                                                    
    Trend Score Real = ───────────────────────                                                                                                   
                              ∑     Pesoᵢ                                                                                                        
                            ativos                                                                                                               
                                                                                                                                                 
  Agora, produtos com tração forte e crescimento real atingem scores proporcionais entre 75 e 95, produtos moderados ficam entre 55 e 72, e      
  produtos em queda ou estabilidade ficam entre 30 e 50.                                                                                         
  ──────                                                                                                                                         
  ### 2. 🧹 Desduplicação de Marketplaces na Página de Fontes / Extração                                                                         
                                                                                                                                                 
  Na listagem de status das fontes de extração (dashboard-api.service.ts):                                                                       
                                                                                                                                                 
  • Fontes Canônicas Unificadas:                                                                                                                 
      1. mercadolivre (Mercado Livre Brasil — Ativo)                                                                                             
      2. amazon_br (Amazon Brasil — Ativo)                                                                                                       
      3. shopee_br (Shopee Brasil — Ativo)                                                                                                       
      4. 1688 (1688 / Alibaba China — Ativo)                                                                                                     
      5. alibaba (Alibaba B2B Global — Ativo)                                                                                                    
      6. amazon (Amazon Global US — Ativo)                                                                                                       
      7. tradeatlas (TradeAtlas Importações — Ativo)                                                                                             
      8. aliexpress (AliExpress — Inativo / Próximos passos)                                                                                     
      9. google_shopping (Google Shopping — Inativo / Próximos passos)                                                                           
      10. google_trends (Google Trends — Inativo / Próximos passos)                                                                              
      11. tiktok_shop (TikTok Shop — Inativo / Próximos passos)                                                                                  
      12. douyin (Douyin China — Inativo / Próximos passos)                                                                                      
      13. xiaohongshu (Xiaohongshu RED — Inativo / Próximos passos)                                                                              
  • Foram eliminadas duplicidades de chaves como mercado_livre vs mercadolivre e apify-1688 vs 1688.                                             
  • Os conectores inativos permanecem registrados e prontos no código para ativação quando as respectivas credenciais/APIs forem plugadas.       
  ──────                                                                                                                                         
  ### 3. 💎 Como Podemos Polir o Sistema (Sugestões de Alto Impacto)                                                                             
                                                                                                                                                 
  Aqui estão as melhores oportunidades de polimento para elevar o sistema ao nível de plataforma executiva enterprise:                           
                                                                                                                                                 
  #### A. 🎨 Polimentos de Interface & Usabilidade Executiva                                                                                     
                                                                                                                                                 
  1. Conectar o Sino de Notificações (Topbar) aos Alertas em Tempo Real:                                                                         
      • Exibir um badge com contador vermelho no topo quando novos produtos romperem marcos de tração, abrindo um modal rápido ao clicar.        
  2. Calculadora de Lote e Ocupação de Container (CBM):                                                                                          
      • No Unit Economics, adicionar um seletor de tipo de container (20ft / 40ft HQ / Carga Fracionada LCL), calculando quantas unidades cabem e
      o custo de frete rateado por m³.                                                                                                           
  3. Filtros Rápidos no Comparador de Produtos:                                                                                                  
      • Adicionar botões de filtro por categoria (Equipamentos Pesados, Acessórios de Treino, Recuperação Muscular) e faixa de preço no topo do  
      /comparador.                                                                                                                               
                                                                                                                                                 
                                                                                                                                                 
  #### B. 🧠 Inteligência & Automação de Dados                                                                                                   
                                                                                                                                                 
  1. Auto-Tagging e Clusterização de Novos Produtos via IA:                                                                                      
      • Classificar automaticamente produtos que entrarem via scraper diário sob seus clusters canônicos corretos usando embeddings de texto.    
  2. Histórico de Variação de Preço dos Concorrentes (Alerta de Guerra de Preços):                                                               
      • Avisar quando um vendedor líder do Mercado Livre / Amazon derrubar o preço em mais de 15%, sinalizando queima de estoque ou entrada de   
      novo concorrente agressivo.                                                                                                                
                                                                                                                                                 
                                                                                                                                                 
  #### C. ⚙️ Engenharia & Operações                                                                                                              
                                                                                                                                                 
  1. Agendador Periódico no Docker (cron-collector):                                                                                             
      • Pré-configurar uma tarefa agendada dentro do container de dados para rodar a varredura a cada 6 ou 12 horas de forma 100% autônoma.      
  2. Painel de Monitoramento dos Proxies e Saúde dos Scrapers:                                                                                   
      • Exibir no painel o tempo de resposta médio das requisições e a taxa de sucesso dos conectores com o Circuit Breaker.   