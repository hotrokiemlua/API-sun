const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const WebSocket = require('ws');

const app = express();
app.use(cors());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;


let txHistory = [];           
let currentTxSession = null;
let lastTxSession = null;


let voltaData = {
    md5_truoc: null,
    ket_qua: null,
    md5_hien_tai: null,
    doi_nha: null,
    doi_khach: null,
    doi_nha_van_truoc: null,
    doi_khach_van_truoc: null
};
let voltaWs = null;
let reconnectAttempts = 0;
let reconnectTimeout = null;



async function fetchTxData() {
    try {
        const response = await fetch('https://markers-amenities-vertex-gratuit.trycloudflare.com/api/tx');
        const data = await response.json();
        
        if (data && data.phien) {
            const formattedData = {
                id: data.phien,
                resultTruyenThong: data.ket_qua === 'Tài' ? 'TAI' : 'XIU',
                dices: [data.xuc_xac_1, data.xuc_xac_2, data.xuc_xac_3],
                point: data.tong,
                time: data.thoi_gian,
                raw: data
            };
            
      
            if (currentTxSession && currentTxSession.id !== formattedData.id) {
                lastTxSession = currentTxSession;
            }
            currentTxSession = formattedData;
            
           
            const exists = txHistory.some(h => h.id === formattedData.id);
            if (!exists) {
                txHistory.unshift(formattedData);
                if (txHistory.length > 30) txHistory.pop();
            }
            
            console.log(`[TÀI XỈU] Phiên ${formattedData.id}: ${formattedData.resultTruyenThong} - ${formattedData.dices.join(',')} = ${formattedData.point}`);
        }
    } catch (error) {
        console.error('[TÀI XỈU] Lỗi vãi lồn:', error.message);
    }
}



function predictTx() {
    if (txHistory.length < 8) {
        return { prediction: 'CHƯA ĐỦ DỮ LIỆU', reason: 'Cần ít nhất 8 phiên', confidence: 0 };
    }
    
    const recent = txHistory.slice(0, 15);
    const results = recent.map(item => item.resultTruyenThong);
    const points = recent.map(item => item.point);
    
   
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
    
    
    let taiCount = results.filter(r => r === 'TAI').length;
    let xiuCount = results.filter(r => r === 'XIU').length;
    
    
    let avgPoint = points.reduce((a,b) => a+b, 0) / points.length;
    let lastAvgPoint = points.slice(0, 5).reduce((a,b) => a+b, 0) / 5;
    
    let prediction = 'TAI';
    let reason = '';
    let confidence = 65;
    
    if (isBệt) {
        prediction = last3[0];
        reason = `Cầu bệt ${prediction === 'TAI' ? 'TÀI' : 'XỈU'} (3 ván cuối giống nhau)`;
        confidence = 75;
    } else if (bệtDài) {
        prediction = last5[0];
        reason = `Cầu bệt dài ${prediction === 'TAI' ? 'TÀI' : 'XỈU'} (5 ván cuối giống nhau)`;
        confidence = 85;
    } else if (isĐảo) {
        prediction = results[0] === 'TAI' ? 'XIU' : 'TAI';
        reason = `Cầu đảo xen kẽ, theo quy luật đảo`;
        confidence = 70;
    } else if (taiCount > xiuCount + 3) {
        prediction = 'XIU';
        reason = `Tài ra nhiều hơn ${taiCount}-${xiuCount}, chuyển Xỉu`;
        confidence = 68;
    } else if (xiuCount > taiCount + 3) {
        prediction = 'TAI';
        reason = `Xỉu ra nhiều hơn ${xiuCount}-${taiCount}, chuyển Tài`;
        confidence = 68;
    } else if (lastAvgPoint > 11.5) {
        prediction = 'TAI';
        reason = `Điểm TB 5 ván gần nhất ${lastAvgPoint.toFixed(1)} > 11.5`;
        confidence = 72;
    } else if (lastAvgPoint < 9.5) {
        prediction = 'XIU';
        reason = `Điểm TB 5 ván gần nhất ${lastAvgPoint.toFixed(1)} < 9.5`;
        confidence = 72;
    } else {
        
        if (avgPoint > 11) {
            prediction = 'TAI';
            reason = `Xu hướng điểm cao (TB ${avgPoint.toFixed(1)})`;
        } else {
            prediction = 'XIU';
            reason = `Xu hướng điểm thấp (TB ${avgPoint.toFixed(1)})`;
        }
        confidence = 60;
    }
    
    return {
        prediction: prediction === 'TAI' ? 'TÀI' : 'XỈU',
        reason: reason,
        confidence: confidence,
        stats: { taiCount, xiuCount, avgPoint: avgPoint.toFixed(1), lastAvgPoint: lastAvgPoint.toFixed(1) }
    };
}



function decodeMatchResult(encodedResult) {
    try {
        let decoded;
        try {
            decoded = decodeURIComponent(encodedResult);
        } catch {
            decoded = encodedResult.replace(/\\u([\d\w]{4})/gi, (match, grp) => {
                return String.fromCharCode(parseInt(grp, 16));
            });
        }
        
        const match = decoded.match(/_{(\d+),(\d+)}_/);
        if (match) {
            const homeScore = parseInt(match[1]);
            const awayScore = parseInt(match[2]);
            
            if (homeScore === 1 && awayScore === 0) return "1-0 (Đội nhà thắng)";
            if (homeScore === 0 && awayScore === 1) return "0-1 (Đội khách thắng)";
            if (homeScore === awayScore) return `${homeScore}-${awayScore} (Hòa)`;
            return `${homeScore}-${homeScore}`;
        }
        return "Không xác định";
    } catch {
        return "Lỗi giải mã";
    }
}

function decodeUnicode(str) {
    return str.replace(/\\u([\d\w]{4})/gi, (match, grp) => {
        return String.fromCharCode(parseInt(grp, 16));
    });
}


function connectVolta() {
    const wsUrl = 'wss://novoga.sb21.net/?token=32-5a4ff6e0fb3f0d90ddf1e9c438c3cb59';
    
    if (reconnectAttempts > 0) {
        console.error(`[VOLTA] Reconnecting attempt ${reconnectAttempts}...`);
    }
    
    if (voltaWs) {
        voltaWs.removeAllListeners();
        try { voltaWs.close(); } catch {}
    }
    
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    voltaWs = new WebSocket(wsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        perMessageDeflate: false
    });
    
    voltaWs.on('open', () => {
        reconnectAttempts = 0;
        console.log('[VOLTA] WebSocket connected');
    });
    
    voltaWs.on('message', (data) => {
        try {
            const json = JSON.parse(data.toString());
            
            if (json.t === "current" && json.d) {
                const decoded = decodeUnicode(json.d);
                const parsed = JSON.parse(decoded);
                
                if (parsed[0]?.[2]?.[0]) {
                    const m = parsed[0][2][0];
                    const currentMd5 = m[29];
                    const currentHomeTeam = m[2];
                    const currentAwayTeam = m[3];
                    
                    voltaData.md5_hien_tai = currentMd5;
                    voltaData.doi_nha = currentHomeTeam;
                    voltaData.doi_khach = currentAwayTeam;
                    
                    if (m[30]) {
                        voltaData.doi_nha_van_truoc = voltaData.doi_nha;
                        voltaData.doi_khach_van_truoc = voltaData.doi_khach;
                        voltaData.md5_truoc = voltaData.md5_hien_tai;
                        voltaData.ket_qua = decodeMatchResult(m[30]);
                        
                        console.log(`[VOLTA] Kết quả: ${voltaData.ket_qua} | ${voltaData.doi_nha_van_truoc} vs ${voltaData.doi_khach_van_truoc}`);
                    }
                }
            }
        } catch (e) {
            
        }
    });
    
    voltaWs.on('error', () => {
        reconnectAttempts++;
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectVolta, 3000);
    });
    
    voltaWs.on('close', () => {
        reconnectAttempts++;
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(connectVolta, 3000);
    });
}


app.get('/api/tx/current', (req, res) => {
    res.json({
        current: currentTxSession,
        last: lastTxSession,
        history: txHistory.slice(0, 15),
        prediction: predictTx()
    });
});

app.get('/api/volta/sun', (req, res) => {
    res.json(voltaData);
});

app.get('/api/all', (req, res) => {
    res.json({
        tai_xiu: {
            current: currentTxSession,
            last: lastTxSession,
            history: txHistory.slice(0, 15),
            prediction: predictTx()
        },
        volta_sun: voltaData
    });
});


app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        tx_last_update: currentTxSession?.time || 'none',
        volta_ws: voltaWs && voltaWs.readyState === 1 ? 'connected' : 'disconnected'
    });
});


app.listen(PORT, () => {
    console.log(` Server chạy tại port ${PORT}`);
    console.log(`API tài xỉu: http://localhost:${PORT}/api/tx/current`);
    console.log(`API Sun: http://localhost:${PORT}/api/volta/sun`);
    console.log("API tổng hợp: http://localhost:${PORT}/api/all`);
    
   
    setInterval(fetchTxData, 5000);
    fetchTxData();
    
   
    connectVolta();
});

process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (voltaWs) try { voltaWs.close(); } catch {}
    process.exit();
});