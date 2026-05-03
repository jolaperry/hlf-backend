import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import * as XLSX from 'xlsx'; // Importamos SheetJS

const app = express();
app.use(cors());
app.use(express.json());

// CONFIGURACIÓN HLF (desde .env)
const HLF_LOGIN_URL = process.env.HLF_LOGIN_URL || 'https://hlf.espex.cl/config/login/LoginFunction.php';
const USERNAME = process.env.HLF_USERNAME;
const PASSWORD_HLF = process.env.HLF_PASSWORD;

// CONFIGURACIÓN HORARIOS LOCALES Y ROTACIÓN
const HORARIOS_FILE = path.join(process.cwd(), 'horarios.json');
const PASSWORD_SINCRO = process.env.PASSWORD_SINCRO;

if (!USERNAME || !PASSWORD_HLF || !PASSWORD_SINCRO) {
    console.error('⚠️  Faltan variables de entorno. Crea un .env con HLF_USERNAME, HLF_PASSWORD, PASSWORD_SINCRO.');
}

// DÍAS FERIADOS A OMITIR (Formato DD-MM)
const FERIADOS = [
    "01-01", "29-03", "01-05", "21-05", "20-06", 
    "16-07", "15-08", "18-09", "19-09", "31-10", 
    "01-11", "08-12", "25-12"
];

// Lista unificada de ejecutivos
const EJECUTIVOS = [
    "Cea Briceño Diego",
    "Ossandon Montoya Edith",
    "Herrera Merida Johanna",
    "Agudelo Viveros Lesli",
    "Barón Barón Maria Cristina",
    "Gonzalez González Yessenia",
    "Herrera Barriga Paola",
    "Manzanilla Rangel Adrian"
];

let currentSessionId = null;
let isAuthenticating = false;

// --- 1. LÓGICA DE AUTENTICACIÓN HLF ---
const authenticateHLF = async () => {
    if (isAuthenticating) {
        while (isAuthenticating) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return currentSessionId;
    }

    isAuthenticating = true;
    try {
        const formData = new URLSearchParams();
        formData.append('input-mail', USERNAME); 
        formData.append('input-pass', PASSWORD_HLF); 

        const response = await fetch(HLF_LOGIN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData,
            redirect: 'manual' 
        });

        const setCookieHeader = response.headers.get('set-cookie');
        if (setCookieHeader) {
            const match = setCookieHeader.match(/PHPSESSID=([^;]+)/);
            if (match) {
                currentSessionId = match[1];
            }
        }
    } catch (error) {
        console.error('Error en autenticación HLF:', error);
    } finally {
        isAuthenticating = false;
    }
    return currentSessionId;
};

// --- 2. ENDPOINTS DE REPORTES Y MONITOR (HLF) ---

app.post('/api/llamadas', async (req, res) => {
    const { fechaDesde, fechaHasta } = req.body;
    
    if (!currentSessionId) await authenticateHLF();

    const fetchDatos = async (sessionId) => {
        const url = `https://hlf.espex.cl/config/apialodesk/llamadas_serverside_processing.php?fechaInicio=${fechaDesde}&fechaTermino=${fechaHasta}&estado=&sentido=0&tipo=0&campana=7&modulo=&draw=1&start=0&length=-1`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "cookie": `PHPSESSID=${sessionId}`, 
                "Referer": "https://hlf.espex.cl/pages/llamadase.php"
            }
        });
        const text = await response.text();
        try { return JSON.parse(text); } catch { return null; }
    };

    let data = await fetchDatos(currentSessionId);
    if (!data || !data.data) {
        const newSessionId = await authenticateHLF();
        if (newSessionId) data = await fetchDatos(newSessionId);
    }

    if (data && data.data) res.json(data);
    else res.status(500).json({ error: "Fallo al conectar con HLF" });
});

app.get('/api/monitor', async (req, res) => {
    if (!currentSessionId) await authenticateHLF();

    const fetchMonitor = async (sessionId) => {
        const url = 'https://hlf.espex.cl/config/monitores/ConfigMonitorAgentes.php';
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "cookie": `PHPSESSID=${sessionId}`,
                "Content-Type": "application/x-www-form-urlencoded",
                "Referer": "https://hlf.espex.cl/"
            }
        });
        const text = await response.text();
        try { return JSON.parse(text); } catch { return null; }
    };

    let data = await fetchMonitor(currentSessionId);
    if (!data) {
        const newSessionId = await authenticateHLF();
        if (newSessionId) data = await fetchMonitor(newSessionId);
    }

    if (data) res.json(data);
    else res.status(500).json({ error: "Fallo en el monitor" });
});

app.get('/api/reporte-agentes', async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: "Faltan fechas" });
    }

    if (!currentSessionId) await authenticateHLF();

    const fetchReporte = async (sessionId) => {
        const url = `https://hlf.espex.cl/config/reportes/TablaReporteAgenteLlamadas.php?startDate=${startDate}&endDate=${endDate}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "cookie": `PHPSESSID=${sessionId}`,
                "Referer": "https://hlf.espex.cl/pages/ReporteAgentes.php"
            }
        });
        
        const text = await response.text();
        try { return JSON.parse(text); } catch { return null; }
    };

    let data = await fetchReporte(currentSessionId);
    
    if (!data || !data.data) {
        const newSessionId = await authenticateHLF();
        if (newSessionId) data = await fetchReporte(newSessionId);
    }

    if (data && data.data) res.json(data);
    else res.status(500).json({ error: "Fallo al obtener reporte de agentes" });
});

// NUEVO ENDPOINT: Descargar y parsear el EXCEL de agentes
app.get('/api/archivo-excel-agentes', async (req, res) => {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ error: "Faltan fechas" });
    }

    if (!currentSessionId) await authenticateHLF();

    const downloadAndParseExcel = async (sessionId) => {
        try {
            // URL CORREGIDA CON LOS PARÁMETROS EXACTOS DE HLF
            const url = `https://hlf.espex.cl/config/reportes/ReporteAgenteLlamadasExcel.php?inicio=${startDate}&final=${endDate}`;
            
            console.log(`Descargando Excel desde: ${url}`); // Para depuración

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    "cookie": `PHPSESSID=${sessionId}`,
                    "Referer": "https://hlf.espex.cl/pages/ReporteAgentes.php"
                }
            });

            if (!response.ok) {
                console.error(`HLF respondió con status: ${response.status}`);
                return null;
            }

            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("text/html")) {
                console.error("HLF devolvió HTML en vez de Excel. Probablemente la sesión caducó o hay un error en los parámetros.");
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            
            if (arrayBuffer.byteLength === 0) {
                 console.error("HLF devolvió un archivo vacío de 0 bytes.");
                 return null;
            }

            // Parseamos el ArrayBuffer como un archivo Excel usando SheetJS
            const workbook = XLSX.read(arrayBuffer, { type: 'array' });

            console.log(`Hojas disponibles en el Excel: ${workbook.SheetNames.join(', ')}`);

            // Buscar la hoja "Estados por Agente" o usar la segunda hoja
            const estadosPreferred = 'Estados por Agente';
            let estadosSheetName = workbook.SheetNames.includes(estadosPreferred)
                ? estadosPreferred
                : workbook.SheetNames.find(s => /estados\s*por\s*agente/i.test(s));
            if (!estadosSheetName) estadosSheetName = workbook.SheetNames[1] || workbook.SheetNames[0];

            // Buscar la hoja "Reporte Detallado Agentes" (match laxo)
            const detalleSheetName = workbook.SheetNames.find(s => /detallad/i.test(s));

            console.log(`Estados por Agente -> "${estadosSheetName}" | Reporte Detallado -> "${detalleSheetName || '(no encontrada)'}"`);

            const jsonEstados = estadosSheetName
                ? XLSX.utils.sheet_to_json(workbook.Sheets[estadosSheetName])
                : [];

            const jsonDetalle = detalleSheetName
                ? XLSX.utils.sheet_to_json(workbook.Sheets[detalleSheetName], { raw: false, defval: '' })
                : [];

            return { estados: jsonEstados, detalle: jsonDetalle };

        } catch (error) {
            console.error("Error al procesar Excel en el servidor:", error);
            return null;
        }
    };

    let data = await downloadAndParseExcel(currentSessionId);

    // Si falló (probablemente sesión expirada), intentamos de nuevo reautenticando
    if (!data) {
        console.log("Reintentando descarga de Excel tras reautenticación...");
        const newSessionId = await authenticateHLF();
        if (newSessionId) data = await downloadAndParseExcel(newSessionId);
    }

    if (data) {
        res.json({ data: data.estados, detalle: data.detalle });
    } else {
        res.status(500).json({ error: "Fallo al descargar o parsear el Excel de agentes" });
    }
});

// --- 3. GESTIÓN DE HORARIOS Y ROTACIÓN EQUITATIVA ---

const initHorarios = async () => {
    try {
        await fs.access(HORARIOS_FILE);
    } catch {
        const initialTemplate = { whatsapp: [], callback: [] };
        await fs.writeFile(HORARIOS_FILE, JSON.stringify(initialTemplate, null, 2));
    }
};
initHorarios();

app.get('/api/horarios', async (req, res) => {
    try {
        const data = await fs.readFile(HORARIOS_FILE, 'utf-8');
        res.json(JSON.parse(data));
    } catch (error) {
        res.status(500).json({ error: "No se pudieron leer los horarios" });
    }
});

app.post('/api/horarios', async (req, res) => {
    const { password, data } = req.body;
    if (password !== PASSWORD_SINCRO) {
        return res.status(401).json({ error: "Contraseña incorrecta" });
    }
    try {
        await fs.writeFile(HORARIOS_FILE, JSON.stringify(data, null, 2));
        res.json({ message: "Sincronizado correctamente" });
    } catch (error) {
        res.status(500).json({ error: "Error al guardar el archivo" });
    }
});

app.post('/api/horarios/generar', async (req, res) => {
    const { mes, año, password } = req.body;

    if (password !== PASSWORD_SINCRO) {
        return res.status(401).json({ error: "No autorizado" });
    }

    const numDias = new Date(año, mes, 0).getDate();
    const nuevosHorarios = { whatsapp: [], callback: [] };
    
    let diaHabilIdx = 0;
    const desfase = Math.floor(EJECUTIVOS.length / 2); 

    for (let dia = 1; dia <= numDias; dia++) {
        const fecha = new Date(año, mes - 1, dia);
        const diaSemana = fecha.getDay();
        const fechaStr = `${String(dia).padStart(2, '0')}-${String(mes).padStart(2, '0')}`;

        if (diaSemana >= 1 && diaSemana <= 5 && !FERIADOS.includes(fechaStr)) {
            nuevosHorarios.whatsapp.push({
                fecha: fechaStr,
                agente: EJECUTIVOS[diaHabilIdx % EJECUTIVOS.length],
                reemplazo: ""
            });

            nuevosHorarios.callback.push({
                fecha: fechaStr,
                agente: EJECUTIVOS[(diaHabilIdx + desfase) % EJECUTIVOS.length],
                reemplazo: ""
            });

            diaHabilIdx++;
        }
    }

    try {
        await fs.writeFile(HORARIOS_FILE, JSON.stringify(nuevosHorarios, null, 2));
        res.json(nuevosHorarios);
    } catch (error) {
        res.status(500).json({ error: "Error al generar archivo" });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor centralizado corriendo en puerto ${PORT}`));