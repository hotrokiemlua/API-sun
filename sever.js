const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

let txHistory = [];
let currentTxSession = null;
let lastTxSession = null;

async function fetchTxData() {
    try {
        const response = await fetch('https://markers-amenities-vertex-gratuit.trycloudflare.com/api/tx');
        const data = await response.json();
        
        if (data && data.phien) {
            const formattedData = {
                phien: data.phien,
                ket_qua: data.ket_qua,
                xuc_xac: [data.xuc_xac_1, data.xuc_xac_2, data.xuc_xac_3],
                tong: data.tong,
                thoi_gian: data.thoi_gian
            };
            
            if (currentTxSession && currentTxSession.phien !== formattedData.phien) {
                lastTxSession = currentTxSession;
            }
            currentTxSession = formattedData;
            
            const exists = txHistory.some(h => h.phien === formattedData.phien);
            if (!exists) {
                txHistory.unshift(formattedData);
                if (txHistory.length > 30) txHistory.pop();
            }
            
            console.log(`Phiên ${formattedData.phien}: ${formattedData.ket_qua} - ${formattedData.xuc_xac.join(',')} = ${formattedData.tong}`);
        }
    } catch (error) {
        console.error('Lỗi:', error.message);
    }
}

function predictTx() {
    if (txHistory.length < 8) {
        return { 
            du_doan: "CHUA_DU_DU_LIEU", 
            ly_do: "Can it nhat 8 phien",
            do_tin_cay: 0
        };
    }
    
    const recent = txHistory.slice(0, 15);
    const results = recent.map(item => item.ket_qua);
    const points = recent.map(item => item.tong);
    
    let last5 = results.slice(0, 5);
    let last3 = results.slice(0, 3);
    
    let isBệt = last3.every(r => r === last3[0]);
    let bệtDài = last5.every(r => r === last5[0]);
    
    let isĐảo = true;
    for (let i = 0; i < Math.min(8, results.length - 1); i++) {
        if (results[i] === results[i+1]) {
            isĐảo = false;
            break;
        }
    }
    
    let taiCount = results.filter(r => r === "Tài").length;
    let xiuCount = results.filter(r => r === "Xỉu").length;
    let avgPoint = points.reduce((a,b) => a+b, 0) / points.length;
    let lastAvgPoint = points.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
    
    let du_doan = "Tài";
    let ly_do = "";
    let do_tin_cay = 65;
    
    if (isBệt) {
        du_doan = last3[0];
        ly_do = `Cau bet ${du_doan}`;
        do_tin_cay = 75;
    } else if (bệtDài) {
        du_doan = last5[0];
        ly_do = `Cau bet dai ${du_doan}`;
        do_tin_cay = 85;
    } else if (isĐảo) {
        du_doan = results[0] === "Tài" ? "Xỉu" : "Tài";
        ly_do = "Cau dao xen ke";
        do_tin_cay = 70;
    } else if (taiCount > xiuCount + 3) {
        du_doan = "Xỉu";
        ly_do = `Tai ra nhieu hon ${taiCount}-${xiuCount}, chuyen Xiu`;
        do_tin_cay = 68;
    } else if (xiuCount > taiCount + 3) {
        du_doan = "Tài";
        ly_do = `Xiu ra nhieu hon ${xiuCount}-${taiCount}, chuyen Tai`;
        do_tin_cay = 68;
    } else if (lastAvgPoint > 11.5) {
        du_doan = "Tài";
        ly_do = `Diem TB 5 van gan nhat ${lastAvgPoint.toFixed(1)} > 11.5`;
        do_tin_cay = 72;
    } else if (lastAvgPoint < 9.5) {
        du_doan = "Xỉu";
        ly_do = `Diem TB 5 van gan nhat ${lastAvgPoint.toFixed(1)} < 9.5`;
        do_tin_cay = 72;
    } else if (avgPoint > 11) {
        du_doan = "Tài";
        ly_do = `Xu huong diem cao (TB ${avgPoint.toFixed(1)})`;
        do_tin_cay = 60;
    } else {
        du_doan = "Xỉu";
        ly_do = `Xu huong diem thap (TB ${avgPoint.toFixed(1)})`;
        do_tin_cay = 60;
    }
    
    return {
        du_doan: du_doan,
        ly_do: ly_do,
        do_tin_cay: do_tin_cay,
        thong_ke: { 
            tai: taiCount, 
            xiu: xiuCount, 
            diem_trung_binh: avgPoint.toFixed(1),
            diem_5_gan_nhat: lastAvgPoint.toFixed(1)
        }
    };
}

app.get('/api/tx/current', (req, res) => {
    res.json({
        phien_hien_tai: currentTxSession,
        phien_truoc: lastTxSession,
        lich_su_15_gan_nhat: txHistory.slice(0, 15),
        du_doan: predictTx()
    });
});

app.get('/api/tx/predict', (req, res) => {
    res.json(predictTx());
});

app.get('/api/tx/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    res.json({
        tong_so: txHistory.length,
        lich_su: txHistory.slice(0, limit)
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: "running",
        last_update: currentTxSession?.thoi_gian || "none",
        total_history: txHistory.length
    });
});

app.listen(PORT, () => {
    console.log(`Server chay o cong ${PORT}`);
    console.log(`API: /api/tx/current`);
    console.log(`Du doan: /api/tx/predict`);
    console.log(`Lich su: /api/tx/history`);
    
    setInterval(fetchTxData, 5000);
    fetchTxData();
});