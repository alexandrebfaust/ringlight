# Chrome Web Store listing

Everything the Developer Dashboard asks for, ready to paste.

- **Package:** `npm run extension:pack` → `dist/ringlight-chrome-<version>.zip`
- **Name and summary:** come from the manifest (`_locales/*/messages.json`)
- **Category:** Communication
- **Language:** English (default), Portuguese (Brazil)
- **Homepage / support:** https://github.com/alexandrebfaust/ringlight
- **Privacy policy:** https://github.com/alexandrebfaust/ringlight/blob/main/PRIVACY.md
- **Images:** `store/screenshots/01–05.png` (1280×800), `store/promo-small-440x280.png`,
  icon `extension/icons/128.png`

## Description (English)

Ringlight turns your screen into a ring light for video calls. A band of soft light
around the page lights your face on camera, and it turns on by itself in the tab that
uses your webcam (Google Meet, Microsoft Teams, Zoom on the web and any other site).

LIGHT
• Shapes: rectangle, oval, circle or side bars
• Color temperature from 2000 K to 9000 K, presets, any color, gradients, a conic sweep, or a different color on each side
• Opacity and intensity, set apart; thickness up to 1000 px; soft inner edge; rounded corners
• Rotate, pulse and color-cycle effects

PER TAB
• Lights up by itself when a tab turns its camera on, and goes off when it stops
• The toolbar icon or Alt + Shift + L switches only the tab you're on
• Hides itself in a tab while that tab shares your screen
• "Shrink the page" fits the page into the clear area, so nothing sits under the light

QUICK PANEL
Click the toolbar icon for an intensity dial, color presets, the shape, color mode,
effects and the main sliders. The full settings page has everything else, in English or
Portuguese.

PRIVACY
No accounts, no tracking, no network requests. Settings stay on your device. The
extension only notices whether a page is using the camera or sharing the screen; it
never reads or records them.

Also available as a free Windows app that lights the whole screen:
https://github.com/alexandrebfaust/ringlight

## Descrição (português)

O Ringlight transforma a sua tela numa luz de anel para videochamadas. Uma faixa de luz
suave ao redor da página ilumina o seu rosto na câmera, e ela acende sozinha na aba que
usa a webcam (Google Meet, Microsoft Teams, Zoom na web e qualquer outro site).

LUZ
• Formatos: retangular, oval, círculo ou barras laterais
• Temperatura de cor de 2000 K a 9000 K, predefinições, qualquer cor, gradientes, cônico ou uma cor por lado
• Opacidade e intensidade separadas; espessura até 1000 px; borda interna suave; cantos arredondados
• Efeitos de girar, pulsar e ciclo de cores

POR ABA
• Acende sozinha quando uma aba liga a câmera e apaga quando ela desliga
• O ícone da barra ou Alt + Shift + L ligam só a aba em que você está
• Se esconde na aba enquanto ela compartilha a sua tela
• "Encolher a página" encaixa a página na área livre, para nada ficar embaixo da luz

PAINEL RÁPIDO
Clique no ícone da barra para ter o dial de intensidade, predefinições de cor, formato,
modo de cor, efeitos e os principais ajustes. A página de configurações tem todo o
resto, em português ou inglês.

PRIVACIDADE
Sem contas, sem rastreamento, sem conexões de rede. As configurações ficam no seu
dispositivo. A extensão só percebe se uma página está usando a câmera ou compartilhando
a tela; ela nunca lê nem grava nada disso.

Também existe como app gratuito para Windows, que ilumina a tela inteira:
https://github.com/alexandrebfaust/ringlight

## Privacy practices

**Single purpose**

Lights the user's face during video calls by drawing a configurable band of light
around the edge of web pages, switched on per tab or automatically when the tab uses
the camera.

**Permission justification: storage**

Saves the user's light settings (color, shape, thickness, language…) and which tabs the
light is switched on in. Everything stays on the device.

**Permission justification: host permissions (content scripts on all sites)**

The light is drawn inside the page itself, so its content script has to run on whatever
site the user takes video calls on (Google Meet, Microsoft Teams, Zoom, Whereby, Jitsi,
Discord and many others, including company-hosted ones), which can't be listed in
advance. The script also notices whether the page has turned the camera on or is sharing
the screen, to switch the light on or hide it. It never reads, records or sends camera
images, screen contents or page contents.

**Remote code:** No, I am not using remote code.

**Data usage:** none of the data types is collected. Certify: not sold to third parties,
not used or transferred for purposes unrelated to the single purpose, not used to
determine creditworthiness or for lending.
