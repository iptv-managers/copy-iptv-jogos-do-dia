# 📺 Copy IPTV Jogos do DIA

Este projeto faz a sincronização automática de canais da Xtream API para o XUI, diretamente no banco de dados.
Ele permite atualizar categorias específicas (exemplo: JOGOS DO DIA) e inserir os canais em outra categoria de destino (exemplo: CANAIS | PREMIERES), cuidando também da atualização dos bouquets.

# ⚙️ Como funciona

Conecta na Xtream API usando username e password.

Busca a lista de canais (get_live_streams).

Filtra os canais de uma categoria de origem (CATEGORY_NAME_SOURCE).

Remove os canais antigos dessa categoria do XUI (streams, servers e categoria).

Cria a nova categoria de destino (CATEGORY_NAME_DESTINATION).

Insere os novos canais com todas as informações (nome, URL, logo, etc).

Atualiza todos os bouquets, removendo os canais antigos e inserindo os novos automaticamente.
