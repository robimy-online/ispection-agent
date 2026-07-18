# Prywatność — agent ispection

> Wersja robocza. Agent jest częścią **hobbystycznego, niekomercyjnego** monitora jakości łączy.
> Uruchamiasz go dobrowolnie; ten dokument opisuje dokładnie, co mierzy i co wysyła.

## Co agent mierzy

- **Ping / dostępność** do publicznych celów (RTT, straty pakietów, jitter).
- **DNS** — czas odpowiedzi resolvera, wykrycie przekierowań NXDOMAIN.
- **Traceroute** — trasa do publicznego celu (lista hopów + opóźnienia).
- **Przepustowość** — okresowy test pobierania (~25 MB) i wysyłania (~8 MB).
- **IPv6** — dostępność względem IPv4.
- **Porty** — dostępność wybranych publicznych usług.

Cele pomiaru to **wyłącznie serwery publiczne** (np. 1.1.1.1, 8.8.8.8, Cloudflare). Agent
**odrzuca cele prywatne/LAN** (RFC1918, CGNAT 100.64/10, loopback, link-local) — także jeśli
przyszłyby z konfiguracji zdalnej. Agent **nie skanuje** Twojej sieci domowej.

## Co agent wysyła

Podpisane (Ed25519) raporty do kolektora (`INGEST_URL`), zawierające:

- wyniki pomiarów (RTT/straty/jitter per cel, DNS, throughput, IPv6, porty),
- hopy traceroute **z zamaskowanymi adresami prywatnymi** (patrz niżej),
- „heartbeat" — stan bufora, czas działania, wersja agenta.

Serwer widzi **publiczny adres IP egress** Twojego łącza (jak każdy serwer w internecie) i używa go
wyłącznie do anty-fałszerstwa; jest zerowany po wycofaniu/dłuższym bezruchu punktu.

## Maskowanie prywatnych adresów (privacy by design)

Traceroute normalnie ujawnia adres Twojej **bramy/routera** (np. `192.168.1.1`). Agent **maskuje
prywatne i zarezerwowane hopy do `null` zanim opuszczą Twoją maszynę** — zachowujemy numer hopa i
opóźnienie, ale **adres z sieci domowej nigdy nie jest wysyłany ani publikowany**. Serwer dodatkowo
maskuje takie adresy na wejściu (backstop dla starszych agentów).

## Co jest publiczne

Twój punkt ma publiczną stronę pod bezpośrednim linkiem `/agent/<token>`:

- **nazwa punktu** (ustalasz ją sam — nie musi to być imię),
- ostatni **RTT / straty pakietów**, status **online/offline**, kalendarz dostępności.

**Nie publikujemy** Twojego adresu IP ani dokładnej lokalizacji. Lista punktów **nie jest nigdzie
wystawiana** — do strony punktu można wejść tylko przez bezpośredni link, który sam udostępnisz.

## Bezpieczeństwo

- Klucz prywatny agenta **zostaje na Twoim sprzęcie** (wolumen `/data`), nie jest nigdy wysyłany.
- Agent **nie wymaga roota** i **nie otwiera portów** nasłuchujących.
- Kod jest otwarty — możesz zweryfikować każde z powyższych.

## Twoje prawa

Możesz w każdej chwili **usunąć swój punkt i jego dane** — napisz na kontakt@robimy.online.
Zatrzymanie agenta przerywa pomiary; usunięcie punktu kasuje jego pomiary i e-mail kontaktowy.

## Wpływ na łącze

Drobne pomiary (ping/DNS/trasa) to kilobajty i nie spowalniają łącza. Test przepustowości okresowo
(domyślnie co ~15 min) na kilka sekund obciąża łącze pełną prędkością — na łączu z **limitem danych**
(LTE/radio) rozrzedź go lub wyłącz zmiennymi środowiskowymi (patrz `README`).
