<div align="center">
  <img src="build/icon.png" width="128" alt="Corujinha" />
  <h1>Corujinha 🦉</h1>
  <p><strong>Um companheiro de IA que mora num canto da sua tela, enxerga o que você está fazendo e te ajuda — local e privado.</strong></p>
</div>

---

## O que é

Corujinha é um app de macOS que vive numa pílula flutuante no topo da tela (estilo Dynamic Island). Você **mostra algo na tela e pergunta** — ele tira um print, manda pro seu modelo de IA rodando **localmente no Ollama** e responde no contexto do que está ali na sua frente.

Nasceu pra estudo, mas serve como um assistente genérico do dia a dia: explicar, traduzir, resumir, criar quiz, guiar um passo a passo, escrever, dar ideias, montar um mapa mental — sempre olhando junto com você.

## Como funciona

```
você mostra a tela  →  pergunta na notch  →  Corujinha vê o print + responde
```

Cada pergunta captura a tela na hora e envia (texto + imagem) para o Ollama via API compatível com OpenAI (`/v1/chat/completions`). Nada sai da sua máquina.

## Recursos

- 🦉 **Notch flutuante** — pílula que expande em painel; arrastar, redimensionar, ajustar opacidade, sempre no topo
- 👁️ **Vê a sua tela** — captura contextual a cada pergunta, com visão do modelo
- 🔒 **Local e privado** — roda 100% no seu Ollama; escondido de gravação/captura de tela (content protection)
- 💬 **Q&A com histórico** — paginação de respostas, regenerar, sugestões de perguntas de continuidade
- 🗂️ **Sessões** — comece uma nova ou continue uma conversa anterior
- 🔎 **Dashboard** — lista e busca (full-text) todas as sessões, com o transcript e **os prints que a IA viu**
- ⌨️ **Atalhos globais** — perguntar, mostrar/esconder, paginar e rolar a resposta — configuráveis
- ⚙️ **Configurável** — URL e modelo do Ollama, opacidade, atalhos, visibilidade em captura

## Requisitos

- macOS (Apple Silicon)
- [Ollama](https://ollama.com) rodando localmente
- Um modelo **com visão** (ex.: `llama3.2-vision`, `qwen2.5vl`, `llava`)

```bash
ollama pull llama3.2-vision
```

## Desenvolvimento

```bash
npm install
npm run dev        # roda em modo desenvolvimento
npm run typecheck  # checagem de tipos
npm test           # testes (vitest)
npm run build      # build de produção
npm run dist       # empacota o .dmg (arm64)
```

Na primeira execução, conceda a permissão de **Gravação de Tela** em Ajustes do Sistema → Privacidade e Segurança (a Corujinha te leva direto pra lá pelas Settings).

## Atalhos padrão

| Ação | Atalho |
|------|--------|
| Perguntar sobre a tela agora | `⌘⇧A` |
| Mostrar / esconder a notch | `⌘⇧H` |
| Resposta anterior / próxima | `⌘⇧←` / `⌘⇧→` |
| Rolar a resposta | `⌘⇧↑` / `⌘⇧↓` |

Os quatro de navegação são editáveis em Settings → Shortcuts.

## Stack

Electron · electron-vite · TypeScript · better-sqlite3 (SQLite + FTS5) · Lucide · Ollama

## Licença

MIT © [maykbrito](https://github.com/maykbrito)
