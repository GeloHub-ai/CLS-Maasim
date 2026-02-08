
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// 1. MIME TYPE CONFIGURATION
try {
    express.static.mime.define({ 'application/javascript': ['tsx', 'ts'] });
} catch (e) {
    console.warn('[SYSTEM] MIME type definition warning:', e.message);
}

// 2. ONLINE-READY CORS POLICY
app.use(cors({
    origin: true, 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Access-Control-Allow-Private-Network']
}));

app.use(express.json({ limit: '100mb' }));

// 3. STATIC FRONTEND FILES
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        if (path.endsWith('.tsx')) {
            res.setHeader('Content-Type', 'application/javascript');
        }
        if (path.endsWith('.png')) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

// 4. ROBUST ASSET SERVING FALLBACK
app.get('/maasim-logo.png', (req, res) => {
    const filePath = path.join(__dirname, 'maasim-logo.png');
    if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
    }
    res.status(404).send('Logo file not found.');
});

// 5. DYNAMIC DATABASE CONNECTION
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:minad@127.0.0.1:5432/legislative_system';

const pool = new Pool({
  connectionString: connectionString,
  family: 4, 
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 30000,
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
        console.log('[SUCCESS] Online Database Schema Verified.');
    } catch (err) {
        console.error('[ERROR] Database Initialization:', err.message);
    }
}

pool.connect((err, client, release) => {
    if (err) {
        console.error('[ERROR] Could not connect to PostgreSQL:', err.message);
    } else {
        console.log('[SUCCESS] PostgreSQL Connected (IPv4 Mode)');
        if (release) release();
        initDb();
    }
});

// 6. API ENDPOINTS

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch (err) {
        res.status(503).json({ status: 'error', database: 'disconnected', message: err.message });
    }
});

// SYSTEM EXPORT: Optimized for large data
app.get('/api/system/export', async (req, res) => {
    const startTime = Date.now();
    try {
        console.log('[SYSTEM] Initiating full system data export...');
        
        // Ensure table exists before querying
        await initDb();

        const result = await pool.query('SELECT store_name, content FROM legislative_data');
        console.log(`[SYSTEM] Database fetched ${result.rowCount} items in ${Date.now() - startTime}ms.`);
        
        const exportData = {};
        result.rows.forEach(row => {
            if (!exportData[row.store_name]) exportData[row.store_name] = [];
            exportData[row.store_name].push(row.content);
        });

        const finalPayload = {
            version: "1.2-CLOUD-STABLE",
            timestamp: new Date().toISOString(),
            data: exportData,
            recordCount: result.rowCount
        };

        console.log(`[SUCCESS] Backup serialization complete. Size: ${Math.round(JSON.stringify(finalPayload).length / 1024)} KB.`);
        res.json(finalPayload);
    } catch (err) {
        console.error('[CRITICAL ERROR] Export Endpoint Failed:', err.stack);
        res.status(500).json({ 
            error: 'Export Failed', 
            reason: err.message,
            tip: 'Check if the database server has enough memory or if the table "legislative_data" exists.' 
        });
    }
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

// 7. SPA CATCH-ALL ROUTE
app.get('*', (req, res) => {
    if (path.extname(req.path)) {
        return res.status(404).send('Not Found');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n--- BACKEND ACTIVE ON PORT ${PORT} ---`);
});

module.exports = app;
