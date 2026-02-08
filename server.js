
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3001;

// 1. MIME TYPE CONFIGURATION
try {
    express.static.mime.define({ 'application/javascript': ['tsx', 'ts'] });
} catch (e) {
    console.warn('[SYSTEM] MIME type definition warning:', e.message);
}

// 2. CORS (Allowed for Vercel/External domains)
app.use(cors({
    origin: true, 
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Access-Control-Allow-Private-Network']
}));

app.use(express.json({ limit: '100mb' }));

// 3. STATIC FILES
app.use(express.static(__dirname, {
    setHeaders: (res, path) => {
        if (path.endsWith('.tsx')) res.setHeader('Content-Type', 'application/javascript');
    }
}));

// 4. CLOUD DATABASE POOLING
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:minad@127.0.0.1:5432/legislative_system';

const pool = new Pool({
  connectionString: connectionString,
  family: 4, 
  max: 10, // Avoid Supabase connection limits
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: (connectionString.includes('supabase') || connectionString.includes('neon.tech') || process.env.NODE_ENV === 'production') 
       ? { rejectUnauthorized: false } 
       : false
});

// Log pool errors
pool.on('error', (err) => {
    console.error('[DB] Unexpected error on idle client:', err.message);
});

async function initDb() {
    let client;
    try {
        client = await pool.connect();
        await client.query(`
            CREATE TABLE IF NOT EXISTS legislative_data (
                id TEXT PRIMARY KEY,
                store_name TEXT NOT NULL,
                content JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_store_name ON legislative_data(store_name);
        `);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        if (client) client.release();
    }
}

// 5. API ENDPOINTS
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'ok', 
            database: 'connected', 
            environment: process.env.NODE_ENV || 'development'
        });
    } catch (err) {
        console.error('[HEALTH] DB check failed:', err.message);
        res.status(503).json({ 
            status: 'error', 
            message: err.message,
            hint: 'Ensure DATABASE_URL environment variable is set in your hosting dashboard.'
        });
    }
});

app.get('/api/system/export', async (req, res) => {
    try {
        const result = await pool.query('SELECT store_name, content FROM legislative_data');
        const exportData = {};
        result.rows.forEach(row => {
            if (!exportData[row.store_name]) {
                exportData[row.store_name] = [];
            }
            exportData[row.store_name].push(row.content);
        });
        res.json({
            version: "1.0-CLOUD",
            timestamp: new Date().toISOString(),
            data: exportData
        });
    } catch (err) {
        console.error('[EXPORT] Failed to create cloud backup:', err.message);
        res.status(500).json({ error: 'Export Error', reason: err.message });
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
        res.status(500).json({ error: 'Read Error', message: err.message });
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
        res.status(500).json({ error: 'Write Error', message: err.message });
    }
});

app.delete('/api/:store/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM legislative_data WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Delete Error', message: err.message });
    }
});

// 6. SPA CATCH-ALL
app.get('*', (req, res) => {
    if (path.extname(req.path)) return res.status(404).send('Not Found');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// 7. LISTEN
app.listen(PORT, '0.0.0.0', async () => {
    const dbStatus = await initDb();
    console.clear();
    console.log(`\x1b[34m╔══════════════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[34m║          LEGISLATIVE DATA BRIDGE SERVER IS RUNNING           ║\x1b[0m`);
    console.log(`\x1b[34m╚══════════════════════════════════════════════════════════════╝\x1b[0m`);
    
    if (dbStatus.ok) {
        console.log(`\x1b[32m[SUCCESS]\x1b[0m Database Linked: ONLINE`);
    } else {
        console.log(`\x1b[31m[ERROR]\x1b[0m Database Error: ${dbStatus.error}`);
    }
    
    console.log(`\nLocal URL: http://localhost:${PORT}`);
    const networkInterfaces = os.networkInterfaces();
    Object.keys(networkInterfaces).forEach((ifName) => {
        networkInterfaces[ifName].forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                console.log(`Network URL: http://${iface.address}:${PORT}`);
            }
        });
    });
});

module.exports = app;
