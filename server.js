
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const os = require('os');

const app = express();

// 1. REINFORCED SECURITY HANDSHAKE (Explicitly for Chrome Mixed Content)
app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Always allow the origin that is requesting
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Access-Control-Allow-Private-Network');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    // CRITICAL: Explicitly handle Chrome's Private Network Access preflight
    if (req.headers['access-control-request-private-network']) {
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }

    // Return 200 OK for OPTIONS pre-flight check immediately
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '100mb' }));

// 2. PostgreSQL Connection (Prefer 127.0.0.1 over localhost)
const pool = new Pool({
  user: 'postgres',           
  host: '127.0.0.1',          
  database: 'legislative_system', 
  password: 'minad',
  port: 5432,
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS legislative_data (
                id TEXT PRIMARY KEY,
                store_name TEXT NOT NULL,
                content JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_store_name ON legislative_data(store_name);
        `);
        console.log('[DATABASE] Tables verified.');
    } catch (err) {
        console.error('[DATABASE] Init Error:', err.message);
    }
}

pool.connect((err, client, release) => {
    if (err) {
        console.error('\n[DATABASE] PostgreSQL connection failed. Ensure PG 18 is running and password is "minad".');
    } else {
        console.log('[DATABASE] PostgreSQL link: ONLINE');
        release();
        initDb();
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
});

app.get('/api/:store', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT content FROM legislative_data WHERE store_name = $1 ORDER BY updated_at DESC', 
            [req.params.store]
        );
        res.json(result.rows.map(row => row.content));
    } catch (err) {
        res.status(500).json({ error: 'DB Read Error' });
    }
});

app.post('/api/:store', async (req, res) => {
    try {
        const { store } = req.params;
        const content = req.body;
        if (!content.id) return res.status(400).json({ error: 'Missing ID' });
        await pool.query(
            `INSERT INTO legislative_data (id, store_name, content, updated_at) 
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (id) DO UPDATE SET content = $3, updated_at = NOW()`,
            [content.id, store, content]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'DB Write Error' });
    }
});

app.delete('/api/:store/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM legislative_data WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'DB Delete Error' });
    }
});

const PORT = 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '═'.repeat(50));
    console.log('  LEGISLATIVE DATA BRIDGE IS ACTIVE');
    console.log('═'.repeat(50));
    console.log(`  Local URL: http://127.0.0.1:${PORT}`);
    console.log('  Status:    WAITING FOR APP CONNECTION');
    console.log('═'.repeat(50) + '\n');
});
