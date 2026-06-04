# LegalBot
LegalBot è un prodotto per studi legali che trasforma WhatsApp in un assistente operativo per la gestione delle richieste dei clienti.
Il prodotto permette a uno studio legale di ricevere messaggi WhatsApp, raccogliere informazioni in modo guidato, creare pratiche, aggiornare lo stato delle richieste, organizzare documenti, generare riepiloghi e ridurre il lavoro manuale ripetitivo legato al primo contatto con il cliente.
LegalBot non sostituisce l’avvocato e non fornisce consulenza legale autonoma. Il suo obiettivo è automatizzare la raccolta, l’organizzazione e la preparazione delle informazioni, lasciando ogni valutazione professionale allo studio.
## Il problema
Molti studi legali ricevono richieste tramite WhatsApp in modo disordinato.
I clienti inviano messaggi incompleti, note vocali, screenshot, documenti, solleciti e aggiornamenti sparsi. Spesso mancano dati essenziali, la conversazione si frammenta e lo studio deve perdere tempo a chiedere più volte le stesse informazioni.
LegalBot risolve questo problema trasformando WhatsApp in un canale strutturato di intake e gestione pratica.
## La soluzione
LegalBot conversa con il cliente su WhatsApp, raccoglie i dati necessari, organizza la richiesta in una pratica e permette allo studio di consultare, aggiornare e gestire il caso con comandi semplici.
Il cliente continua a usare WhatsApp normalmente.
Lo studio ottiene un flusso più ordinato, tracciabile e veloce.
## Funzionamento generale
Il flusso previsto del prodotto è semplice.
Il cliente scrive allo studio su WhatsApp.
LegalBot risponde automaticamente, identifica la richiesta e guida il cliente nella raccolta delle informazioni principali.
Quando le informazioni sono sufficienti, il sistema crea o aggiorna una pratica interna.
Lo studio può interrogare la pratica, leggerne il riepilogo, richiedere documenti mancanti, modificare lo stato, chiuderla o eliminarla.
Il cliente riceve risposte e aggiornamenti coerenti con lo stato della pratica.
## Esempio di conversazione cliente
```txt
Cliente:
Buongiorno, ho un problema con un contratto non rispettato.
LegalBot:
Buongiorno. Ti aiuto a raccogliere le informazioni necessarie per lo studio.
Puoi indicarmi il tuo nome e cognome?
Cliente:
Mario Rossi.
LegalBot:
Grazie Mario. Puoi descrivere brevemente cosa è successo?
Cliente:
Ho firmato un contratto a marzo, ma la controparte non ha consegnato il servizio.
LegalBot:
Hai una copia del contratto o altri documenti utili da inviare?
Cliente:
Sì, li mando ora.
```
Alla fine del percorso, lo studio riceve una pratica ordinata.

Pratica: CASE-AA002
Cliente: Mario Rossi
Categoria: contratto
Stato: intake completato
Urgenza: media
Fatti principali:
- contratto firmato a marzo
- servizio non consegnato
- cliente dispone di documenti
Documenti ricevuti:
- contratto.pdf
- screenshot_conversazione.png
Informazioni mancanti:
- dati completi della controparte
- eventuali solleciti già inviati

## Esempio di comandi per lo studio

Lo studio può interagire con LegalBot direttamente da WhatsApp.
```
stato AA002
```
Risposta:
```
Pratica AA002
Stato: INTAKE_COMPLETE
Ultimo aggiornamento: 2026-04-25 12:36
```
```
riepilogo AA002
```
Risposta:
```
Pratica AA002
Cliente: Mario Rossi
Oggetto: possibile inadempimento contrattuale
Documenti presenti: contratto.pdf, screenshot_conversazione.png
Prossima azione: revisione avvocato
```
```
chiudi AA002
```
Risposta:
```
Pratica AA002 chiusa.
```
```
elimina AA002
```
Risposta:
```
Richiesta di eliminazione registrata.
Per confermare scrivi: conferma eliminazione AA002
```

## Funzionalità del prodotto

LegalBot prevede un sistema completo di gestione pratica via WhatsApp.

Le funzionalità principali sono:

* ricezione messaggi WhatsApp
* risposta automatica al cliente
* intake guidato
* classificazione della richiesta
* creazione pratica
* aggiornamento stato pratica
* comandi riservati allo studio
* riepilogo pratica
* gestione allegati
* controllo informazioni mancanti
* follow-up automatici
* chiusura pratica
* eliminazione protetta con conferma
* log operativo
* separazione tra cliente e operatore
* protezione contro risposte duplicate
* ignorare messaggi inviati dal bot stesso
* preparazione di output per revisione umana

## Stati della pratica

Ogni pratica ha uno stato chiaro.

Esempi di stati previsti:

NEW_CONTACT
INTAKE_STARTED
INTAKE_IN_PROGRESS
INTAKE_COMPLETE
LAWYER_REVIEW
WAITING_CLIENT
WAITING_DOCUMENTS
CLOSED
DELETION_PENDING
DELETED

Questo consente allo studio di sapere sempre dove si trova una richiesta.

## Tipi di pratiche gestibili

LegalBot può essere configurato per diverse aree operative.

Esempi:

* contratti
* recupero crediti
* lavoro
* famiglia
* locazioni
* sinistri
* privacy
* diritto societario
* contenzioso
* consulenza generale
* richieste documentali
* appuntamenti
* aggiornamenti pratica

La struttura è modulare: ogni studio può definire i propri flussi, le proprie categorie e le proprie domande.

## Gestione documenti

Il prodotto finito può associare documenti e allegati alla pratica.

Esempi di allegati:

* PDF
* immagini
* screenshot
* documenti Word
* scansioni
* ricevute
* contratti
* comunicazioni
* prove fotografiche

Ogni allegato viene collegato alla pratica corretta e può essere usato per costruire il riepilogo operativo.

## Riepiloghi e output

LegalBot può generare riepiloghi strutturati per lo studio.

Esempi di output:

* scheda pratica
* cronologia eventi
* elenco documenti ricevuti
* elenco documenti mancanti
* sintesi dei fatti
* domande ancora aperte
* memo interno
* report per revisione
* bozza di comunicazione non definitiva

Ogni contenuto generato deve essere verificato dallo studio prima dell’uso professionale.

## Controllo umano

LegalBot è pensato per lavorare con supervisione umana.

Il sistema può raccogliere, ordinare, classificare e preparare informazioni.

Non deve decidere autonomamente strategie legali, responsabilità, probabilità di vittoria, compensi, atti o conclusioni professionali.

La decisione resta sempre all’avvocato.

## Architettura

LegalBot è costruito con una separazione netta tra trasporto WhatsApp e logica applicativa.

Il flusso principale è:

Messaggio WhatsApp
-> Trasporto
-> Normalizzazione
-> Routing
-> Runtime conversazione
-> Stato pratica
-> Decisione prossima azione
-> Piano di risposta
-> Invio risposta WhatsApp

Il trasporto WhatsApp non contiene logica legale.

La logica di prodotto resta separata, testabile e sostituibile.

Trasporto WhatsApp

LegalBot usa OpenWA come base gratuita e open-source per l’automazione di WhatsApp Web.

OpenWA viene usato per:

* aprire una sessione WhatsApp Web
* mostrare il QR di collegamento
* mantenere la sessione locale
* ricevere messaggi
* inviare messaggi
* esporre gli eventi WhatsApp al runtime applicativo

OpenWA è solo il livello di trasporto.

Il prodotto non dipende da WhatsApp Cloud API e non richiede una configurazione Meta Business per lo sviluppo locale.

Moduli del sistema

Transport

Gestisce WhatsApp.

Responsabilità:

* connessione a WhatsApp Web
* QR pairing
* sessione locale
* ricezione messaggi
* invio messaggi
* gestione errori di trasporto

Normalizer

Converte i messaggi WhatsApp in un formato interno stabile.

Responsabilità:

* estrarre mittente
* estrarre chat
* estrarre testo
* riconoscere messaggi da ignorare
* identificare allegati
* produrre un input canonico

## Router

Decide come trattare il messaggio.

Responsabilità:

* distinguere cliente e operatore
* capire se il messaggio è un comando
* associare il messaggio a una pratica
* decidere il ramo del flusso

## Runtime

Gestisce la conversazione.

Responsabilità:

* stato conversazione
* idempotenza
* prevenzione duplicati
* gestione errori
* avanzamento pratica
* persistenza eventi

## Case Manager

Gestisce le pratiche.

Responsabilità:

* creazione pratica
* aggiornamento pratica
* chiusura pratica
* cancellazione protetta
* recupero riepilogo
* gestione stati

Document Manager

Gestisce file e allegati.

Responsabilità:

* salvataggio documenti
* associazione alla pratica
* classificazione file
* controllo documenti mancanti
* esportazione

Output Planner

Costruisce le risposte.

Responsabilità:

* decidere cosa inviare
* preparare messaggi cliente
* preparare messaggi operatore
* evitare risposte non consentite
* applicare template

Dispatcher

Invia le risposte tramite WhatsApp.

Responsabilità:

* invio testo
* invio allegati
* gestione fallimenti
* log dispatch
* retry controllati

Stack tecnico

Il prodotto è pensato per uno stack semplice, locale e open-source.

Node.js
TypeScript
OpenWA
Vitest
SQLite o PostgreSQL
File storage locale o compatibile S3
PDF/document generation

Lo stack può essere eseguito localmente, su server privato o in ambiente self-hosted.

Perché open-source

LegalBot nasce per evitare lock-in e costi iniziali non necessari.

Principi:

* codice controllabile
* runtime self-hosted
* dati sotto controllo dello studio
* nessuna dipendenza obbligatoria da API WhatsApp a pagamento
* architettura modulare
* trasporto sostituibile
* test automatici
* sicurezza by design

Sicurezza

LegalBot gestisce dati potenzialmente sensibili.

Il prodotto deve rispettare regole chiare:

* non salvare segreti nel repository
* non committare sessioni WhatsApp
* non committare file .env
* non loggare token
* non loggare contenuti sensibili inutilmente
* separare dati cliente e log tecnico
* proteggere i comandi operatore
* richiedere conferma per azioni distruttive
* mantenere audit trail sulle operazioni rilevanti
* permettere cancellazione o chiusura pratica
* limitare l’accesso ai numeri autorizzati

Privacy

Le conversazioni con i clienti possono contenere dati personali, documenti e informazioni riservate.

Il prodotto deve essere installato e configurato in modo coerente con gli obblighi dello studio.

In produzione, lo studio deve definire:

* base giuridica del trattamento
* informativa privacy
* tempi di conservazione
* criteri di cancellazione
* accessi autorizzati
* backup
* cifratura
* protezione degli allegati
* policy sui log
* gestione data breach

LegalBot fornisce la struttura tecnica, ma la conformità finale dipende dalla configurazione e dall’uso dello studio.

Limiti

LegalBot non è un avvocato.

LegalBot non deve:

* fornire consulenza legale autonoma
* promettere esiti
* calcolare probabilità di vittoria
* decidere strategie
* inviare atti senza revisione
* sostituire il controllo umano
* generare pareri definitivi senza approvazione

Il prodotto serve ad assistere lo studio nella gestione operativa.

Modalità operative

LegalBot può lavorare in più modalità.

Modalità cliente

Gestisce il primo contatto e raccoglie informazioni.

Modalità studio

Permette a operatori autorizzati di consultare e gestire pratiche.

Modalità amministrativa

Permette comandi protetti come chiusura, riapertura, cancellazione e audit.

Modalità automazione

Permette integrazioni future con strumenti esterni, webhook, scheduler o workflow.

Esempi di casi d’uso

Studio piccolo

Uno studio individuale usa LegalBot per non perdere richieste WhatsApp e ricevere riepiloghi ordinati prima di richiamare il cliente.

Studio strutturato

Un team usa LegalBot per smistare richieste per categoria, assegnare pratiche e mantenere aggiornato lo stato.

Recupero documenti

Lo studio usa LegalBot per chiedere automaticamente documenti mancanti e ricordare al cliente cosa deve inviare.

Pre-valutazione

LegalBot raccoglie i fatti principali e prepara una scheda interna per la revisione dell’avvocato.

Aggiornamenti pratica

Il cliente può chiedere lo stato della pratica e ricevere informazioni consentite senza interrompere il lavoro dello studio.

Roadmap prodotto

Fase 1: Trasporto WhatsApp

* collegamento WhatsApp Web
* ricezione messaggi
* invio risposte
* sessione persistente
* runtime stabile

Fase 2: Runtime conversazionale

* filtro messaggi da sé
* deduplica messaggi
* gestione errori
* comandi base
* log strutturati

Fase 3: Gestione pratiche

* database
* creazione pratica
* stati pratica
* comandi operatore
* riepilogo pratica

Fase 4: Intake guidato

* domande dinamiche
* categorie pratica
* dati obbligatori
* informazioni mancanti
* completamento intake

Fase 5: Allegati

* ricezione file
* associazione pratica
* classificazione documenti
* controllo documenti mancanti

Fase 6: Documenti e report

* scheda pratica
* riepilogo PDF
* checklist
* memo interno
* esportazione

Fase 7: Automazioni

* follow-up
* reminder
* webhook
* integrazioni opzionali
* workflow esterni

Fase 8: AI assistita

* classificazione messaggi
* estrazione dati
* sintesi conversazioni
* bozze operative
* controllo umano obbligatorio

Comandi esempio

Cliente:

ciao
vorrei aprire una pratica
ho un problema con un contratto
ti mando il documento
qual è lo stato della mia richiesta?

Operatore:

stato AA002
riepilogo AA002
documenti AA002
chiudi AA002
riapri AA002
elimina AA002
conferma eliminazione AA002

Esempio di esperienza finale

Il cliente scrive:

Ciao, vorrei parlare con un avvocato per un problema di lavoro.

LegalBot risponde:

Ciao. Ti aiuto a raccogliere le informazioni principali per lo studio.
Per iniziare, puoi indicarmi nome e cognome?

Il cliente risponde:

Mario Rossi.

LegalBot continua:

Grazie Mario. Puoi descrivere brevemente il problema di lavoro?

Il cliente scrive:

Sono stato licenziato senza preavviso.

LegalBot chiede:

Hai ricevuto una lettera di licenziamento o una comunicazione scritta?
Se sì, puoi inviarla qui in chat.

Il cliente invia un PDF.

LegalBot conclude:

Grazie. Ho raccolto le informazioni principali.
La richiesta sarà revisionata dallo studio.
Riferimento pratica: CASE-AA002

Lo studio può poi scrivere:

riepilogo AA002

e ricevere:

Pratica CASE-AA002
Cliente: Mario Rossi
Categoria: lavoro
Oggetto: licenziamento senza preavviso
Documento ricevuto: lettera_licenziamento.pdf
Stato: INTAKE_COMPLETE
Prossima azione: revisione avvocato

Obiettivo finale

LegalBot vuole diventare il livello operativo WhatsApp per studi legali.

Non un semplice chatbot.

Non un generatore automatico di pareri.

Non un sistema chiuso.

Ma una piattaforma open-source, modulare e self-hosted per trasformare conversazioni disordinate in pratiche strutturate, verificabili e utilizzabili dallo studio.

Licenza

Da definire.