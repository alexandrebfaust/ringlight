# Ringlight

Uma ringlight de tela para reuniões: acende uma faixa de luz no contorno do monitor
para iluminar seu rosto na webcam. A faixa fica sempre por cima de tudo, mas os
cliques passam por ela; você continua usando o computador normalmente.

Feita com [Tauri 2](https://tauri.app) (Rust + HTML). Por enquanto roda só no Windows.

## Recursos

- **Cor**: predefinições de temperatura (2700 K a 6500 K), slider de 2000 K a 9000 K ou qualquer cor personalizada
- **Brilho, espessura, suavidade** (degradê para dentro da tela) e **cantos arredondados**
- **Monitor**: principal, todos ou um específico; a sobreposição se ajusta quando você conecta, desconecta ou muda a resolução
- **Ocultar ao compartilhar a tela**: usa `WDA_EXCLUDEFROMCAPTURE`, então a luz não aparece para quem vê seu compartilhamento (Teams, Meet, Zoom, OBS, prints)
- **Ligar junto com a câmera**: acende quando algum app começa a usar a webcam e apaga quando ela desliga (só se foi a câmera que acendeu)
- **Atalho global** (padrão `Ctrl + Alt + L`) para ligar e desligar de qualquer lugar
- **Iniciar com o Windows**: abre na bandeja, com a luz apagada
- **Ícone na bandeja** desenhado com a cor atual da luz. Clique para abrir as configurações; clique com o botão direito para ligar, desligar ou sair

## Rodando

Pré-requisitos:

- Node.js
- Rust via rustup. O `rust-toolchain.toml` fixa o toolchain **1.90 GNU**
  (`x86_64-pc-windows-gnu`), que não precisa das ferramentas de C++ do Visual Studio.
  Para instalar: `rustup toolchain install 1.90-x86_64-pc-windows-gnu`
- MinGW-w64 no `PATH` (`windres` embute o ícone e o manifesto no `.exe`). Nesta
  máquina ele está em `C:\ProgramData\mingw64\mingw64\bin`.
- WebView2, que já vem no Windows 11

Para usar o MSVC, instale "Desenvolvimento para desktop com C++" no Visual Studio
e troque o canal no `rust-toolchain.toml` para `"1.90"`.

```bash
npm install
npm run dev      # modo de desenvolvimento
npm run build    # gera o .exe e o instalador
```

Saída do build:

- `src-tauri/target/release/ringlight.exe`: executável avulso
- `src-tauri/target/release/bundle/nsis/Ringlight_0.1.0_x64-setup.exe`: instalador

## Estrutura

```
src/                  interface (HTML/CSS/JS puro, sem bundler)
  index.html, app.js  janela de configurações
  overlay.html        a faixa de luz desenhada em cada monitor
src-tauri/src/
  lib.rs              estado, comandos, bandeja, atalho e tarefa de fundo
  overlay.rs          cria e posiciona uma janela transparente por monitor
  win.rs              ajustes Win32: clique atravessa, sem foco, fora do Alt+Tab, sempre no topo
  camera.rs           detecta o uso da webcam pelo registro do Windows
  tray.rs             ícone e menu da bandeja
  settings.rs         configurações e persistência
```

As configurações ficam em `%APPDATA%\com.alexandre.ringlight\settings.json`.

## Como funciona

Cada monitor escolhido recebe uma janela do tamanho da tela, transparente, sem
bordas e marcada com `WS_EX_TRANSPARENT | WS_EX_LAYERED` (o mouse atravessa),
`WS_EX_NOACTIVATE` (nunca rouba o foco) e `WS_EX_TOOLWINDOW` (fora do Alt+Tab).
A faixa é um "buraco" com `box-shadow` gigante: a sombra pinta tudo ao redor do
buraco com a cor da luz, e o desfoque cria o degradê.

Uma tarefa de fundo roda a cada segundo. Ela coloca a sobreposição de volta acima
de outras janelas "sempre no topo" (a barra de tarefas, por exemplo), confere a
posição nos monitores, acompanha a câmera e salva as configurações.
