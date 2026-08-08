# Mwongozo wa Malipo (Payment Guide)

Huu ni mwongozo mfupi wa jinsi malipo yanavyofanya kazi kwenye mfumo huu, hatua za kuthibitisha, na sababu kwanini baadhi ya `server details` (username, email, password) zinaweza kuonekana kuwa hazipo.

## A. Muhtasari wa mtiririko wa malipo
- Mtumiaji anaweza kulipa kwa `Coins` (wallet) au kwa `PalmPesa` (pay-by-link / USSD).
- Kwa `Coins`: mfumo utaunda server mara moja (ikiwa kifurushi kinauto-creation), kisha ukapunguze coins kwa wakati huo.
- Kwa `PalmPesa` au malipo ya nje: mfumo huanzisha transaction na kutuma request kwa gateway (PalmPesa). Malipo haya yanahitaji kuthibitishwa kupitia webhook au ukaguzi wa admin kabla ya kukatwa/kukamilishwa.

## B. Kwa nini `username/email/password` hazijaonekana mara moja
Sababu kuu za kutoonekana kwa taarifa za login ni:

- Hakuna Client API key: vipengele vya kutoa `server access` (username/password) hutegemea endpoints za Client API za Pterodactyl. Kama `PTERODACTYL_CLIENT_API_KEY` haijawekwa au sio `ptlc_...` (client key), API ya client haiwezi kurudisha credentials.
- Akaunti ya mtumiaji haijaunganishwa: kama akaunti ya mtumiaji haijaunganishwa (haina `pteroId`), makaazi ya server au ufikiaji wa SFTP hauwezekani.
- Server bado inaundwa / iko kwenye queue: wakati wa kuunda server, panel inaweza kuwa bado inatengeneza container—credentials hazitolewi mpaka hatua ya `start_on_completion` itakapokamilika.
- Malipo hayajakamilika: kwenye njia za malipo za nje, huduma inaweza kusubiri uthibitisho (webhook) au ukaguzi wa admin kabla ya kugawa credentials.

Kwa hivyo, ikiwa `username/email/password` hazipo, tafuta yafuatayo: (1) hakikisha `PTERODACTYL_CLIENT_API_KEY` imewekwa kama `ptlc_...`, (2) angalia status ya transaction (imalizike), (3) hakikisha akaunti yako imeunganishwa kwenye panel.

## C. Jinsi Admin anaweza kuona malipo ya nje (external)
- Kuna API ya admin: `GET /api/payment/admin/all` ambayo inarudisha transactions za watumiaji. Admin UI inaruhusu kuona orodha ya malipo, hali, na kujibu (approve/reject).
- Katika Dashboard ya Admin, kuna sehemu ya `Payments` ambayo inaonyesha malipo yote; pia jumla za malipo za nje zinaweza kuhesabiwa kwa pamoja (gateway != 'admin').

## D. Mwongozo wa haraka kwa watumiaji na admin
- Watumiaji: kwa malipo ya PalmPesa, fungua link ya malipo uliopokea kwenye browser au kukamilisha USSD kwa simu. Muda wa uthibitisho unaweza kuchukua sekunde-chache hadi dakika.
- Admin: angalia `Payments` tab kwenye `/admin.html`. Taarifa muhimu:
  - Source/Provider: (PalmPesa/manual/admin)
  - Kiasi: kuonekana katika sarafu inayofaa (Tsh au Coins)
  - Hali: `pending`, `completed`, `failed`
  - Uthibitisho: admin anaweza `Approve & Create` ili kuunda server baada ya kuthibitisha malipo ya nje.

## E. Ndani ya mfumo (kwa developer)
- Transaction model inahifadhi `paymentMethod`, `paymentProvider`, `metadata` (kama `phone`, `orderId`), `status`.
- Webhook ya PalmPesa inafuatilia reference inayotuma gateway (order_id/reference) na ku-update transaction (`/api/payment/webhook`).

---

Ikiwa unataka, ninaweza:
- Kuongeza validation ya URL ya git (`botRepoUrl`) wakati wa checkout.
- Kurekebisha UI ili kuonyesha popup ya server details moja kwa moja kwenye ukurasa wa `Payments` au `Docs`.
