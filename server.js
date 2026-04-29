// server.js
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors()); 
app.use(express.json());

app.post('/api/llamadas', async (req, res) => {
    const { fechaDesde, fechaHasta, phpsessid } = req.body;
    
    const url = `https://hlf.espex.cl/config/apialodesk/llamadas_serverside_processing.php?fechaInicio=${fechaDesde}&fechaTermino=${fechaHasta}&estado=&sentido=0&tipo=0&campana=7&modulo=&draw=1&start=0&length=-1`;

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "x-requested-with": "XMLHttpRequest",
                "cookie": `PHPSESSID=${phpsessid}`, 
                "Referer": "https://hlf.espex.cl/pages/llamadase.php"
            }
        });

        const text = await response.text();
        const data = JSON.parse(text);
        
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: "Fallo en la comunicación con HLF" });
    }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor puente corriendo en el puerto ${PORT}`));