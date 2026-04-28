// server.js
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); // Permite que tu React local se conecte sin errores
app.use(express.json());

// Creamos un "puente" o "endpoint" para tu React
app.post('/api/llamadas', async (req, res) => {
    const { fecha, phpsessid } = req.body;
    
    const url = `https://hlf.espex.cl/config/apialodesk/llamadas_serverside_processing.php?fechaInicio=${fecha}&fechaTermino=${fecha}&estado=&sentido=0&tipo=0&campana=7&modulo=&draw=1&start=0&length=-1`;

    try {
        // Aquí Node.js hace la petición (¡A Node sí le dejan enviar cookies!)
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "cookie": `PHPSESSID=${phpsessid}`, // Node inyecta la cookie de tu UI
                "Referer": "https://hlf.espex.cl/pages/llamadase.php"
            }
        });

        const text = await response.text();
        const data = JSON.parse(text);
        
        // Devolvemos los datos crudos a React
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Fallo en la comunicación con HLF" });
    }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`🚀 Servidor puente corriendo en http://localhost:${PORT}`));