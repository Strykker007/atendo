"""Benchmark de embeddings no Ollama: mesmo formato e lote (4) que o Atendo usa com endpoint local."""
import json, math, random, sys, time, urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:11435/v1/embeddings"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "bge-m3"
N = int(sys.argv[3]) if len(sys.argv) > 3 else 200

def embed(texts):
    req = urllib.request.Request(URL, data=json.dumps({"model": MODEL, "input": texts}).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    return [x["embedding"] for x in sorted(d["data"], key=lambda x: x["index"])], d.get("usage", {}).get("prompt_tokens")

temas = {
    "mudança": "As mudanças de entrada ou saída de moradores só podem ocorrer de segunda a sábado, das 8h às 18h, com agendamento prévio na administração e uso obrigatório do elevador de serviço protegido. É proibida a mudança aos domingos e feriados.",
    "animais": "É permitida a permanência de animais domésticos de pequeno e médio porte nas unidades, desde que não causem incômodo aos vizinhos. Nas áreas comuns, os animais devem circular no colo ou com guia curta, sendo proibido o acesso à piscina e ao salão de festas.",
    "barulho": "O silêncio deve ser respeitado das 22h às 8h. Obras e reformas que gerem ruído só podem ser realizadas de segunda a sexta, das 9h às 17h, e aos sábados das 9h às 13h, mediante comunicação à administração.",
    "piscina": "A piscina funciona de terça a domingo, das 9h às 21h. Menores de 12 anos devem estar acompanhados de responsável. É obrigatório o uso de traje de banho adequado e proibido levar recipientes de vidro.",
    "garagem": "Cada unidade tem direito às vagas indicadas na convenção. É proibido estacionar em vagas de terceiros, na faixa de circulação ou deixar objetos nas vagas. A velocidade máxima na garagem é de 10 km/h.",
    "multa": "O descumprimento deste regimento sujeita o infrator a advertência por escrito e, na reincidência, a multa equivalente a uma taxa condominial, aplicada pelo síndico e cobrada no boleto do mês seguinte.",
}
random.seed(1)
filler = "O condômino deverá observar as disposições da convenção e da legislação vigente, zelando pela conservação das áreas comuns e pela boa convivência entre os moradores. "
passages = []
for i in range(N):
    tema = list(temas)[i % len(temas)]
    txt = f"Art. {i+1}. {temas[tema]} " + filler * 5
    passages.append(txt[:1200])
avg_chars = sum(map(len, passages)) / len(passages)

t = time.time(); embed(["aquecimento"]); load = time.time() - t
qs = ["posso fazer mudança no domingo?", "pode ter cachorro no prédio?", "até que horas pode fazer barulho?", "qual o horário da piscina?", "quanto é a multa?"]
lat = []
for q in qs:
    t = time.time(); embed([q]); lat.append(time.time() - t)

t = time.time(); vecs = []; tokens = 0
for i in range(0, len(passages), 4):
    v, tk = embed(passages[i:i+4]); vecs += v; tokens += tk or 0
total = time.time() - t

def norm(v):
    n = math.sqrt(sum(x*x for x in v)) or 1
    return [x/n for x in v]
P = [norm(v) for v in vecs]
acertos = 0
for q, tema in zip(qs, ["mudança", "animais", "barulho", "piscina", "multa"]):
    qv = norm(embed([q])[0][0])
    best = max(range(len(P)), key=lambda i: sum(a*b for a, b in zip(qv, P[i])))
    ok = temas[tema][:40] in passages[best]
    acertos += ok
print(json.dumps({
    "modelo": MODEL, "dimensoes": len(vecs[0]), "trechos": N, "media_chars": round(avg_chars),
    "tokens_total": tokens, "tokens_por_trecho": round(tokens / N) if tokens else None,
    "carga_inicial_s": round(load, 2), "pergunta_s_media": round(sum(lat)/len(lat), 3), "pergunta_s_max": round(max(lat), 3),
    "documento_total_s": round(total, 1), "por_trecho_s": round(total / N, 3),
    "busca_certa": f"{acertos}/5",
}, ensure_ascii=False, indent=1))
