# Privacy policy

Ringlight (the desktop app and the Chrome extension) does not collect, store or send any
personal data.

## What the extension does

- **Settings** (color, shape, thickness, language and the like) are saved with
  `chrome.storage.local`, on your device only.
- **Which tabs the light is on in** is kept in `chrome.storage.session`, which Chrome
  clears when the browser closes. A tab's entry is removed when the tab closes.
- To turn the light on with the camera and hide it while sharing the screen, the
  extension notices **whether** a page has turned its camera on or is sharing the
  screen. It never reads, records or sends camera images, screen contents, page
  contents, URLs or browsing history.
- It makes no network requests: no analytics, no ads, no accounts, no remote code.

## What the desktop app does

The app saves its settings in a local file
(`%APPDATA%\com.alexandre.ringlight\settings.json`). To turn on with the camera, it
reads the Windows camera-usage record to know **whether** an app is using the webcam.
It never accesses the camera itself and makes no network requests.

## Contact

Questions: open an issue at https://github.com/alexandrebfaust/ringlight/issues

---

# Política de privacidade

O Ringlight (o app e a extensão do Chrome) não coleta, guarda nem envia nenhum dado
pessoal.

- As **configurações** ficam só no seu dispositivo (`chrome.storage.local` na extensão,
  um arquivo local no app).
- **Em quais abas a luz está ligada** fica em `chrome.storage.session`, que o Chrome
  apaga ao fechar o navegador.
- Para ligar com a câmera e se esconder ao compartilhar a tela, a extensão só percebe
  **se** a página ligou a câmera ou está compartilhando a tela. Ela nunca lê, grava ou
  envia imagens da câmera, conteúdo da tela, conteúdo das páginas, endereços ou
  histórico.
- Não há nenhuma conexão de rede: sem estatísticas, anúncios, contas ou código remoto.

Dúvidas: https://github.com/alexandrebfaust/ringlight/issues
