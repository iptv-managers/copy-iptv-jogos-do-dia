/**
 * Esse arquivo nós iremos acessar o XUI deletar todos os canais da categoria de jogos
 * com o nome presente na const CATEGORY_NAME_SOURCE, e CATEGORY_NAME_DESTINATION
 * Depois iremos inserir os canais que estão no arquivo m3u, no servidor
 */
require('dotenv').config();
const mysql = require('mysql2/promise');
const axios = require('axios');

// --- CONFIGURAÇÕES ---
const {
    DB_HOST, DB_USER, DB_PASSWORD, DB_NAME,
    XTREAM_API_URL, XTREAM_USERNAME, XTREAM_PASSWORD,
    CATEGORY_NAME_SOURCE, CATEGORY_NAME_DESTINATION
} = process.env;


let STREAM_ID_SOURCE = null;

if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME || !XTREAM_API_URL || !XTREAM_USERNAME || !XTREAM_PASSWORD) {
    console.error("ERRO: Configure todas as variáveis no arquivo .env");
    process.exit(1);
}


async function fetchXtreamCategoryByName() {
    try {
        const res = await axios.get(`${XTREAM_API_URL}/player_api.php`, {
            params: {
                username: XTREAM_USERNAME,
                password: XTREAM_PASSWORD,
                action: 'get_live_categories'
            }
        });

        if (res.data && Array.isArray(res.data)) {
            res.data.forEach(c => {
                if(c.category_name === CATEGORY_NAME_SOURCE) {
                    STREAM_ID_SOURCE = c.category_id
                }
            });
        }
        if(!STREAM_ID_SOURCE) {
            console.error(`❌ Categoria "${CATEGORY_NAME_SOURCE}" não encontrada na API Xtream.`);
            process.exit(1);
        }
        return STREAM_ID_SOURCE;
    } catch (err) {
        console.error("Erro ao acessar Xtream API:", err.message);
        return [];
    }
}
async function fetchXtreamChannels() {
    try {
        const res = await axios.get(`${XTREAM_API_URL}/player_api.php`, {
            params: {
                username: XTREAM_USERNAME,
                password: XTREAM_PASSWORD,
                action: 'get_live_streams'
            }
        });

        if (res.data && Array.isArray(res.data)) {
            const channels = [];

            res.data.forEach(c => {
                if(c.category_id == STREAM_ID_SOURCE) {
                     channels.push({
                        id: c.num,
                        name: c.name,
                        category: CATEGORY_NAME_SOURCE,
                        url: `${XTREAM_API_URL}/${XTREAM_USERNAME}/${XTREAM_PASSWORD}/${c.stream_id}`,
                        logo: c.stream_icon || null 
                    })
                }

            });
            return channels;
        }

        console.error("[CHAN] API Xtream retornou dados inválidos.");
        return [];
    } catch (err) {
        console.error("Erro ao acessar Xtream API:", err.message);
        return [];
    }
}

async function main() {
    console.log("Iniciando sincronização via Xtream API...");
    let dbPool;
    try {
        dbPool = mysql.createPool({
            host: DB_HOST,
            user: DB_USER,
            password: DB_PASSWORD,
            database: DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        console.log("Conectado ao MySQL.");
        await fetchXtreamCategoryByName();
        const canais = await fetchXtreamChannels();

        console.log(`Encontrados ${canais.length} canais na categoria "${CATEGORY_NAME_SOURCE}".`);

        const connection = await dbPool.getConnection();
        await connection.beginTransaction();

        try {
            // --- Deletar canais antigos dessa categoria ---
            const [oldCats] = await connection.query(
                "SELECT id FROM streams_categories WHERE category_name IN (?)",
                [CATEGORY_NAME_DESTINATION]
            );
            let oldStreamIds = [];

            if (oldCats.length > 0) {
                const catIds = oldCats.map(c => c.id);

                const [oldStreams] = await connection.query(
                    `SELECT id FROM streams WHERE category_id = ?`,
                    `[${catIds[0]}]`
                );
                oldStreamIds = oldStreams.map(s => s.id);

                if (oldStreams.length > 0) {
                    await connection.query(`DELETE FROM streams_servers WHERE stream_id IN (${oldStreamIds.map(() => '?').join(',')})`,
                        oldStreamIds
                    );
                    await connection.query(`DELETE FROM streams WHERE id IN (${oldStreamIds.map(() => '?').join(',')})`,
                        oldStreamIds
                    );
                }

                await connection.query(`DELETE FROM streams_categories WHERE id IN (${catIds.map(() => '?').join(',')})`,
                    catIds
                );
            }

            // --- Inserir a nova categoria de destino ---
            const [catRes] = await connection.query(
                "INSERT INTO streams_categories (category_type, category_name, cat_order) VALUES (?, ?, ?)",
                ['live', CATEGORY_NAME_DESTINATION, 1]
            );
            const categoryId = catRes.insertId;

            // --- Inserir os canais da Xtream ---
            const newStreamIds = [];
            for (let i = 0; i < canais.length; i++) {
                const c = canais[i];
                const [res] = await connection.query(
                    "INSERT INTO streams (type, category_id, stream_display_name, stream_source, stream_icon, read_native, `order`, custom_sid, added, gen_timestamps, direct_source, allow_record, probesize_ondemand) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                        1,
                        `[${categoryId}]`,
                        c.name,
                        `["${c.url}"]`,
                        c.logo,
                        false,
                        i + 1,
                        c.id || `jogo_${i+1}`,
                        Math.floor(Date.now() / 1000),
                        false,
                        false,
                        false,
                        542000
                    ]
                );

                const streamId = res.insertId;
                newStreamIds.push(streamId);

                await connection.query(
                    "INSERT INTO streams_servers (stream_id, server_id, on_demand) VALUES (?, ?, ?)",
                    [streamId, 1, true]
                );
            }

            // --- Atualizar bouquets ---
            console.log("Atualizando bouquets...");
            const [bouquets] = await connection.query("SELECT id, bouquet_name, bouquet_channels FROM bouquets");

            for (const b of bouquets) {
                // bouquet_channels vem como string "[1010, 1515]"
                let currentChannels = [];
                try {
                    currentChannels = JSON.parse(b.bouquet_channels || "[]");
                } catch {
                    currentChannels = [];
                }

                // 1) Remover canais antigos (streamIds que foram deletados)
                currentChannels = currentChannels.filter(ch => !oldStreamIds.includes(ch));

                // 2) Adicionar os novos canais
                const updatedChannels = [...new Set([...currentChannels, ...newStreamIds])];

                // 3) Atualizar no banco
                await connection.query(
                    "UPDATE bouquets SET bouquet_channels = ? WHERE id = ?",
                    [JSON.stringify(updatedChannels), b.id]
                );
            }

            await connection.commit();
            console.log("✅ Sincronização concluída!");
        } catch (err) {
            await connection.rollback();
            throw err;
        } finally {
            connection.release();
        }

    } catch (err) {
        console.error("Erro:", err.message);
    } finally {
        if (dbPool) await dbPool.end();
        console.log("Pool de conexões encerrado.");
    }
}

main();
