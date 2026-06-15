# PLP + Hedge Vault — Poora Plan, Layman Terms Mein

Yeh document samjhata hai ki **PLP + Hedge Vault** kya hai, hum kyun bana rahe hain, paise kaise aayenge, aur ek math grad ka edge yahaan kahaan kaam karta hai.

Bhaari technical baatein neeche likhi hain — pehle casino-style example se concept clear karte hain, phir actual implementation samjhayenge.

---

## Part 1 — Casino Wala Example (Concept Samjho)

### Step 1: Casino kya karta hai

Socho tumne ek chhota casino khola. Tumhare paas ek table hai jahaan log baith ke shart lagate hain:

> *"Kya BTC agle 15 minute mein $70,500 ke upar jaayega?"*

Tum (casino owner) ho. Tumhare paas ₹10 lakh ka **bankroll** hai.

Ek player aata hai. Bolta hai:
- *"Main ₹40 lagaata hoon ki BTC upar jaayega. Agar mein jeeta, mujhe ₹100 do."*

Tum bolte ho: **Theek hai.**

- Tumne ₹40 le liya
- Tumne **₹100 ka promise** kar diya (agar woh jeeta to)
- Tumhara potential nuksaan: ₹60 (₹100 − ₹40)
- Tumhara potential laabh: ₹40 (jo tumne le liya)

Ye ek **binary option** hai. Hum isse ek "mint" kehte hain DeepBook Predict mein.

### Step 2: Maths kaisa lagta hai casino mein

Ek baar ki shart ka **expected value** kya hai?

Maan lo BTC ka actual probability upar jaane ka 50% hai.

- 50% chance: player jeeta → tumne ₹60 khoye
- 50% chance: player haara → tumne ₹40 kamaye
- Expected = (0.5 × −60) + (0.5 × 40) = **−₹10**

Aaaa! Tumne galat price diya. Yeh casino doob jaayega.

**Sahi pricing**:
- Player ko probability ke hisaab se charge karo
- Agar 50% chance UP hai, to UP ki shart ka **fair price = 50% × ₹100 = ₹50**
- Tum ₹50 charge karo (ya thoda zyaada — ₹52 — taaki tumhe edge mile)
- Ab expected = (0.5 × −48) + (0.5 × 52) = **+₹2 per bet** for tum

Yahi DeepBook Predict bhi karta hai. Wahaan ek **SVI volatility surface** chip ke andar baithi hai jo har strike aur expiry ka fair price calculate karti hai. Player jab `mint` karta hai, woh fair price + thoda markup deta hai.

### Step 3: PLP kya hai

DeepBook Predict mein **tum khud casino owner nahi banoge**. Bahut zyaada capital chahiye, har trade pe risk hai, complicated hai.

Lekin DeepBook ne ek **collective pool** banaya hai. Tum apna paisa is pool mein daal sakte ho. Sab logon ka paisa milke ek bada bankroll banta hai. Phir woh poora pool sab bettors ke saamne casino ka kaam karta hai.

Pool mein paisa daalne ke badle tumhe **PLP token** milta hai. Yeh tumhare share dikhata hai.

```
Tumne ₹10,000 dUSDC dia → PLP token miley
Total pool ₹1,00,00,000 dUSDC hai → tumhara share 0.1%
```

Jab casino (pool) profit kamata hai, tumhara share ka NAV badhta hai. Tumhare PLP tokens ki value badhti hai.

### Step 4: Toh PLP rakhna achha hai? Haan, lekin...

PLP ka return aata hai chhote chhote profits se. Har bet pe ₹2-3 ka markup. Lakhon bet hote hain, sab milke pool ka NAV badhta hai. Annual return roughly **20-25%** ho sakta hai.

**Sunne mein bahut achha hai. Lekin...**

Ek din BTC achanak 5% upar shoot ho jaata hai. **Sab UP-bettors jo OTM (out-of-the-money) shart laga ke baithe the, jeet jaate hain.** Pool ko ek saath crore rupaye dene padte hain.

Pool ka NAV ek din mein **30-50% gir sakta hai**.

```
Casino's life:
  ┌─ Roj ₹500/day kamao (chai paani ka kharcha)
  ┌─ Roj ₹500/day kamao
  ┌─ Roj ₹500/day kamao
  └─ Ek din ₹5,00,000 dena pad gaya 😱
```

Yeh problem hai. **Naked PLP rakhna = chhupa hua bomb.**

### Step 5: Insurance ka idea — Hedge

Tum casino ho. Tumhare paas ek chhupa risk hai: ek din sab bettors ek saath jeet jaayenge.

Solution: **Tum khud bettor ban jaao.** Lekin sirf un strikes pe jahaan tumhe nuksaan hoga.

Specifically: jo OTM bets sabse zyaada paid out karte hain (jaise BTC +5%), un par tum khud chhoti chhoti shart laga lo.

> *"Agar BTC +5% upar gaya, casino ko nuksaan hoga, lekin meri personal shart bhi jeet jaayegi. Donon cancel out ho gaye."*

Yeh hi **hedge** hai.

Cost: thodi premium dena padta hai apni shart pe. Per month maybe 0.5% of NAV.

Benefit: woh ek bura din jab pool ka NAV 30% gir sakta tha, ab sirf 5% girta hai. Aur tumhari hedge usi din 25% paid out kar deti hai.

**Net result:**
- Pehle: 20% APY, but max drawdown −30% on bad days
- Ab: 14% APY (kyunki hedge cost lagti hai), but max drawdown −5%

**Sleep at night.** Yahi product hai.

---

## Part 2 — Real Numbers (Concrete Example)

Maan lo Vault mein ₹1 crore hai. Apne dUSDC daal diye ki taur pe samjhata hoon ($1 = ₹83 maan ke).

### Without hedge (naked PLP)

| Scenario | Probability | NAV change |
|---|---|---|
| Normal day | 95% | +0.05% |
| Mildly volatile | 4% | −0.5% |
| Stress day (3σ move) | 1% | −15% |

**Annualized expected return**: ~22% APY
**Max drawdown observed**: −30% (jab back-to-back stress days aate hain)
**Sharpe ratio**: 1.2 (achha lagta hai jab tak crash na ho)

### With hedge

Hum har expiry pe NAV ka ~6% (annualized rate) hedge mein lagaate hain. Specifically, OTM binaries ke strips kharidte hain.

| Scenario | Probability | Naked PLP NAV change | Hedge PnL | Net |
|---|---|---|---|---|
| Normal day | 95% | +0.05% | −0.02% | **+0.03%** |
| Mildly volatile | 4% | −0.5% | +0.1% | **−0.4%** |
| Stress day | 1% | −15% | +10% | **−5%** |

**Annualized expected return**: ~14-16% APY
**Max drawdown observed**: −5% to −7%
**Sharpe ratio**: 2.5+ (institutionally investable)

Notice: tumne **8% APY chhod diya hedge cost mein**, lekin tumne apna max drawdown −30% se −5% pe le aaye. **Yeh trade hai.**

---

## Part 3 — Hum Paisa Kaise Kamaayenge

Hum vault ke **operator** hain. User log apna dUSDC humare vault mein daalte hain. Hum unko share token dete hain. Vault casino owner ka kaam karta hai. Hedge bhi.

### Revenue streams

1. **Performance fee** — 20% of net positive returns
2. **Management fee** — 1% per year on AUM

### Earnings table

| AUM (Total deposits) | Net APY | Vault earnings (perf fee + mgmt fee) |
|---|---|---|
| $100,000 | 15% | $3,000 + $1,000 = **$4,000/year** |
| $500,000 | 15% | $15,000 + $5,000 = **$20,000/year** |
| $1,000,000 | 15% | $30,000 + $10,000 = **$40,000/year** |
| $5,000,000 | 15% | $150,000 + $50,000 = **$200,000/year** |
| $20,000,000 | 15% | $600,000 + $200,000 = **$800,000/year** |

**Realistic milestones**:
- Mainnet day 1: $50k-$100k AUM (sirf hum aur dosti wallets)
- Month 3: $500k-$1M (early LP traction)
- Month 6: $2M-$5M (DeepBook ecosystem partnership)
- Year 1: $10M-$20M (audit done, batch unlocked, integrations live)

Yeh **realistic** numbers hain, "moonshot" nahi. Sui DeFi ecosystem chhota hai abhi (~$100M total TVL), lekin reasonably khaali hai aur woh DeepBook ke saath grow ho raha hai.

---

## Part 4 — Tumhara Edge Yahaan Kyun Kaam Karta Hai

### Yeh sab koi bhi nahi bana sakta?

Naive version koi bhi bana sakta hai. **Aisa**:

> *"Bhai, NAV ka 10% le ke hamesha 2 sigma OTM puts/calls kharid lo. Done."*

Aisa vault 5/10 hai. Cost too high in calm regimes, hedge sizing static, koi optimization nahi. Year-end pe maybe 8% net APY niklega.

### Tumhara version (math grad)

Char layers ka quant work jo tumhare alawa kisi ko nahi aata jaldi se:

#### 1. **Dynamic hedge sizing based on PLP utilization**

Sirf jab pool busy ho (lot of bets going through), tab zyaada hedge kharido. Jab quiet ho, kam.

```
Utilization 80% → hedge intensity 1.2x baseline
Utilization 30% → hedge intensity 0.5x baseline
```

Yeh single optimization se 200-400 bps net APY badh jaata hai. Math: utilization se variance ka relation, optimal Kelly hedging — yeh tumhare liye textbook material hai.

#### 2. **Realized vs Implied vol gap**

DeepBook ka SVI surface se IV (implied vol) milti hai. Tum BTC spot price ka history se RV (realized vol) calculate karte ho.

- Agar **IV > RV** → market khoob bhayaa hua hai, hedges mehnge hain → kam kharido, farther OTM strikes
- Agar **IV < RV** → market sasta beech raha hai → zyaada hedges kharido

Yeh exactly woh maths hai jo CBOE traders karte hain. Tumhare 4-year math degree mein yeh 1st year ka problem set hai. Implementation thodi mehnat lagti hai (rolling window vol estimation, ATM IV interpolation from SVI), lekin closed-form hai.

#### 3. **Skew-aware delta hedging via DeepBook spot**

Pool mein bettors kabhi ek tarafa lagate hain (bull din → sab UP lagate hain). Yeh pool ko **direction risk** deta hai jo binary option payoffs se bhi badh ke ho sakta hai.

Tum DeepBook spot pe live BTC long/short kar ke yeh neutralize kar sakte ho. **Most prediction vaults yeh karte hi nahi.** Tumne kar diya → 100-200 bps risk-adjusted return added.

#### 4. **Drawdown-targeted construction**

Investors "% APY" se zyaada "max drawdown" ke baare mein sochte hain. Tumhara vault ek explicit promise karta hai:

> *"5% se zyaada drawdown nahi hoga, agar BTC 8σ ke andar moved kare to."*

Yeh number tum **structurally guarantee** kar sakte ho via hedge sizing. Math: capacity constraints + worst-case scenario simulation. Output: ek number jo marketing kar sakte ho.

---

## Part 5 — Hum Kyu Jeet Sakte Hain

Char moats stack hote hain:

### Moat 1: Math literacy (6-12 month head start)

Naive PLP wrapper fork kar sakta hai koi bhi ek hafte mein. Lekin hedge optimization layer? Ek quant ko 1 mahina lagta hai design karne mein, aur Move developer ko 1 saal sahi se implement karne mein. Tumhare paas dono hain.

### Moat 2: First-mover AUM

Mainnet day 1, *koi to* "hedged PLP" offer karega. Agar woh hum hain, sticky LP capital aata hai humare paas. By month 3, "Hunchbook Vault" answer hota hai "kahan rakhoon mera dUSDC?" ka.

### Moat 3: Composability

Humare vault ka share token (`pvhBTC` ya `pfdUSDC` jaisa naam) agar DeepBook ke margin protocol aur Iron Bank mein collateral ke taur pe accepted ho jaata hai, to log humare token ko rakhne ki ek aur wajah mil jaati hai. Yeh negotiate karna hai DeepBook team ke saath — idea bank items #1 aur #4 mein explicitly mention hai ki team yeh chahti hai.

### Moat 4: Audit moat

OtterSec ya MoveBit ya Zellic se audit karwaane mein $30-60k lagta hai. Yeh ek-time cost hai. Copy-cat ko bhi yeh karna padega. Bina audit ke serious LPs paisa nahi denge — toh audit khud apna moat ban jaata hai.

---

## Part 6 — Kaise Banaayenge (Realistic Plan)

### Phase A — Backtest (2-3 hafte, solo)

**Sabse pehla kaam: maths validate karo.**

DeepBook ka testnet indexer pe sab events public hain. Hum pull karenge:
- Saare `OracleSVIUpdated` events (vol surface ka history)
- Saare `mint`/`redeem` events (kaun kis price pe kya khareeda)
- BTC spot price history

In sab ko Jupyter notebook mein dhal ke hum **simulated vault** chalaayenge — humare hedge sizing rules ko apply kar ke. Output:

- Net APY chart
- Max drawdown chart
- Sharpe ratio
- Stress test under different scenarios

Agar simulation 14-16% APY aur −5% drawdown deta hai, **green light**. Agar nahi, hum yahin ruk ke tweaks karenge — Move contract likhne ki zaroorat nahi.

**Risk if we skip this**: 2 mahine vault contract likh ke pata chala ki theory practical mein toot gayi. Time wasted. Always backtest first.

### Phase B — Move Vault Contract (3-4 hafte)

Phase A pass hone ke baad:

- Move smart contract jo `predict::supply` + `predict::mint` ko wrap karta hai
- `pvh-share` token issue karta hai (SUI fungible token)
- Off-chain keeper service jo har naye expiry pe hedges roll karta hai
- Pause function, admin time-lock, capacity caps (safety features)
- Testnet pe 2 hafte run karo paper-money mode mein

### Phase C — Audit + Launch (2-3 hafte)

- Audit ke liye OtterSec/MoveBit ko contact karo
- Small frontend (just deposit/withdraw + APY + drawdown chart)
- Private LP list ko soft pitch
- Hackathon submission

### Phase D — Post-hackathon

- Predict mainnet pe deploy day 1
- AUM caps slowly raise karna (no $50M on day 1)
- Compound

Total time: **8-10 hafte** for first version. Most of it is Phase A + B.

---

## Part 7 — Where Things Can Go Wrong (Honest Risks)

### Risk 1: Calm market regime

Market 2-3 mahine flat ho gaya. Bettor flow gir gaya. PLP yield gir ke 8% reh gaya. Hedge cost 6% reh gaya. **Net APY 2% reh jaayega.**

**Mitigation**: Dynamic hedge sizing. Quiet days mein hedge band karo. Lekin yeh requires monitoring + active management.

### Risk 2: Mainnet adoption sucks

Maan lo Predict mainnet launch hua, lekin koi use nahi kar raha. Pool empty hai. Yields zero hain.

**Mitigation**: Yeh "platform risk" hai — humare control mein nahi. Hum vault ko gracefully scale-up/scale-down kar sakte hain. Agar AUM low rehta hai, hum gas costs minimize karte hain aur wait karte hain.

### Risk 3: Catastrophic loss

Black Monday aaya. BTC 12σ move kiya. Humne sirf 8σ tak ka hedge size kiya tha. **Vault NAV 15% giri.** Trust gone.

**Mitigation**:
- Explicit capacity caps (jab tak production-tested nahi hai, AUM cap rakho)
- Multi-layer hedges (additional cheap tail insurance)
- Transparent communication ("ye hua kyunki ye hua")

### Risk 4: Smart contract bug

Move code mein bug, koi attacker pool drain kar deta hai. **Existential.**

**Mitigation**:
- Audit before scaling AUM beyond $500k
- Pause function (admin can freeze deposits/withdrawals)
- Time-locked admin keys (24-48h delay on critical ops)
- Bug bounty program

### Risk 5: Regulatory

Prediction markets dicey hain regulation-wise in many jurisdictions. Vault is "structured product" → "investment fund" → may need licenses.

**Mitigation**:
- Initial deploy: testnet + small group of crypto-native LPs only
- Geo-block if needed
- Legal review before going public mainnet

---

## Part 8 — Aaj Se Hum Kya Karein

Yeh document tumhare liye reference hai. Agar yeh idea tumhe achhi lagi, neeche steps order mein:

### Immediate (is hafte):

1. **Hackathon deadline check** — abhi yahaan hackathon mode mein hain. Deepbook ka submit deadline kab hai? Hum vault build kar payenge ya nahi us timeline mein?

2. **Telegram bot ka kya hoga?** Woh humne build kiya hai. Demo ke liye useful hai. Lekin focus shift karne ka decision lo.

3. **Quick sanity check**: indexer pe ek expiry ka actual data pull karke dekh lo. SVI parameters reasonable hain? Bettor flow realistic hai? Yeh 30 minute ka kaam hai.

### Phase A start karne se pehle:

1. Decide karo: **vault ke saath telegram bot saath chalayenge ya bot ko shelve karenge?**
   - **Together (recommended)**: Bot becomes the "deposit funnel" + consumer surface. Vault is the engine. Same product, two faces.
   - **Shelve bot**: Sirf vault. Bot ko hackathon ke baad dekha jaayega.

2. Phase A backtest ka project setup karo: separate folder, separate package. Existing bot ko mat chedo.

3. Indexer se historical data fetch karne ka script likho. **First milestone**: 7 din ka complete event log apne paas pull karke save karna.

---

## Summary in 5 Lines

1. **PLP = casino ka maalik banna**. Roj chhote profits, kabhi-kabhi crash.
2. **Hedge = casino ki insurance**. Premium dete ho, crash se bachte ho.
3. **Net product**: ~15% APY, max 5% drawdown. **Investable. Defensible.**
4. **Edge**: math literacy + first-mover + composability + audit.
5. **Goal**: $1M-$20M AUM in 12-18 months = $40k-$800k/year revenue.

Yeh **vol-arb se zyaada slow** lagega. Lekin **safer, scalable, defensible**. Tumhare jaise math grad ke liye yeh ek ideal first crypto product hai.

---

## Quick Glossary

- **dUSDC** — DeepBook ka stable coin (testnet). Tumhara base currency.
- **Binary option** — "yes/no" bet, pays $1 if event hits, $0 otherwise.
- **Strike** — woh price level jiske upar ya neeche payoff trigger hota hai.
- **OTM** (Out-of-the-money) — strike spot se duur, low probability, low cost
- **ATM** (At-the-money) — strike spot ke kareeb, ~50% probability
- **ITM** (In-the-money) — strike already pass ho gaya, high probability, high cost
- **IV** (Implied Volatility) — option price se nikla hua expected volatility number
- **RV** (Realized Volatility) — actual historical price moves se calculate hua volatility
- **SVI surface** — vol surface ka mathematical parameterization (a, b, rho, m, sigma)
- **Delta** — kitna NAV change hota hai per $1 BTC move
- **PLP** — Predict LP token (humare casino mein shareholder banne ka receipt)
- **NAV** (Net Asset Value) — total vault value / share count = per-share price
- **AUM** (Assets Under Management) — total paisa jo vault mein deposited hai
- **Sharpe ratio** — return per unit of risk (>2 means investably good)
- **Drawdown** — peak se kitna gir gaye, percentage mein
- **Kelly fraction** — bet size optimization formula, given edge and variance
