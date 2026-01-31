
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();

// 1. ONLINE-READY CORS POLICY
app.use(cors({
    origin: true, 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Access-Control-Allow-Private-Network']
}));

app.use(express.json({ limit: '100mb' }));

// 2. DYNAMIC DATABASE CONNECTION
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:minad@127.0.0.1:5432/legislative_system';

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
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
        console.log('[SYSTEM] Online Database Schema Verified.');
    } catch (err) {
        console.error('[ERROR] Database Initialization:', err.message);
    }
}

pool.connect((err, client, release) => {
    if (err) {
        console.error('[ERROR] Could not connect to PostgreSQL:', err.message);
    } else {
        console.log('[SUCCESS] Legislative System Database: ONLINE');
        if (release) release();
        initDb();
    }
});

// 3. MASTER BACKUP EXPORT
app.get('/api/system/export', async (req, res) => {
    try {
        const result = await pool.query('SELECT store_name, content FROM legislative_data');
        const exportData = result.rows.reduce((acc, row) => {
            if (!acc[row.store_name]) acc[row.store_name] = [];
            acc[row.store_name].push(row.content);
            return acc;
        }, {});
        
        res.json({
            version: "2.0",
            timestamp: new Date().toISOString(),
            data: exportData
        });
    } catch (err) {
        res.status(500).json({ error: 'Export Failed' });
    }
});

// 4. API ENDPOINTS
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        mode: isProduction ? 'cloud' : 'local',
        timestamp: new Date().toISOString() 
    });
});

app.get('/api/:store', async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT content FROM legislative_data WHERE store_name = $1 ORDER BY updated_at DESC', 
            [req.params.store]
        );
        res.json(result.rows.map(row => row.content));
    } catch (err) {
        res.status(500).json({ error: 'Read Error' });
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
        res.status(500).json({ error: 'Write Error' });
    }
});

app.delete('/api/:store/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM legislative_data WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete Error' });
    }
});

// Export for Vercel Serverless Functions
module.exports = app;

// For local development only (Vercel ignores this block)
if (!process.env.VERCEL && !process.env.NODE_ENV) {
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\n--- LEGISLATIVE SYSTEM BACKEND ---`);
        console.log(`Status: Running on Port ${PORT}`);
    });
}
