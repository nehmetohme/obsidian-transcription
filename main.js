"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");

class TranscriptionModal extends obsidian_1.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.transcription = "";
    }

    onOpen() {
        const {contentEl} = this;
        contentEl.empty();

        // Create a container for the transcription
        const transcriptionContainer = contentEl.createEl("div", { cls: "transcription-container" });

        // Create the transcription element with increased size
        this.transcriptionEl = transcriptionContainer.createEl("textarea", { 
            cls: "transcription-text",
            attr: { readonly: "true" }
        });
        this.transcriptionEl.value = "Transcription will appear here...";

        // Create a container for the button to allow centering
        const buttonContainer = contentEl.createEl("div", { cls: "button-container" });

        // Create the Save button
        const saveButton = buttonContainer.createEl("button", { text: "Save", cls: "save-button" });
        saveButton.addEventListener("click", () => {
            this.plugin.flushTranscription(this.transcription);
            this.transcription = "";
            this.transcriptionEl.value = "Transcription saved. New transcription will appear here...";
        });

        // Add CSS for styling
        this.addStyle();
    }

    onClose() {
        const {contentEl} = this;
        contentEl.empty();
    }

    updateTranscription(text) {
        this.transcription = text;
        this.transcriptionEl.value = text;
    }

    addStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .transcription-container {
                margin-bottom: 20px;
            }
            .transcription-text {
                width: 100%;
                height: 200px;
                resize: vertical;
                font-family: inherit;
                font-size: 14px;
                padding: 10px;
            }
            .button-container {
                display: flex;
                justify-content: center;
            }
            .save-button {
                font-size: 16px;
                padding: 8px 16px;
            }
        `;
        document.head.append(style);
    }
}

class AudioTranscriptionPlugin extends obsidian_1.Plugin {
    constructor() {
        super(...arguments);
        this.isRecording = false;
        this.ws = null;
        this.mediaRecorder = null;
        this.audioContext = null;
        this.stream = null;
        this.transcriptionModal = null;
    }

    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            this.ribbonIcon = this.addRibbonIcon('microphone', 'Toggle Audio Transcription', () => {
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            });

            this.addCommand({
                id: 'toggle-audio-transcription',
                name: 'Toggle Audio Transcription',
                callback: () => {
                    if (this.isRecording) {
                        this.stopRecording();
                    } else {
                        this.startRecording();
                    }
                }
            });
        });
    }

    onunload() {
        this.stopRecording();
    }

    startRecording() {
        this.isRecording = true;
        this.ribbonIcon.setAttribute('aria-label', 'Stop Audio Transcription');
        new obsidian_1.Notice('Audio transcription started');
        this.connectWebSocket();
        this.startAudioCapture();
        this.transcriptionModal = new TranscriptionModal(this.app, this);
        this.transcriptionModal.open();
    }

    stopRecording() {
        if (!this.isRecording) return;

        this.isRecording = false;
        this.ribbonIcon.setAttribute('aria-label', 'Start Audio Transcription');
        new obsidian_1.Notice('Audio transcription stopped');

        if (this.mediaRecorder) {
            this.mediaRecorder.stop();
            this.mediaRecorder = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.transcriptionModal) {
            this.transcriptionModal.close();
            this.transcriptionModal = null;
        }
    }

    flushTranscription(text) {
        const activeLeaf = this.app.workspace.activeLeaf;
        if (activeLeaf) {
            const view = activeLeaf.view;
            if (view instanceof obsidian_1.MarkdownView) {
                const editor = view.editor;
                const currentContent = editor.getValue();
                const newContent = currentContent + "\n\n" + text;
                editor.setValue(newContent);
                editor.setCursor(editor.lineCount(), 0);
                new obsidian_1.Notice('Transcription flushed to note');
            } else {
                new obsidian_1.Notice('Please open a markdown file to save the transcription.');
            }
        } else {
            new obsidian_1.Notice('No active file. Please open a markdown file to save the transcription.');
        }
    }

    connectWebSocket() {
        const wsUrl = `ws://localhost:8000/v1/audio/transcriptions`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket connection opened');
        };

        this.ws.onmessage = (event) => {
            const text = event.data;
            this.updateTranscriptionModal(text);
        };

        this.ws.onclose = () => {
            console.log('WebSocket connection closed');
            if (this.isRecording) {
                new obsidian_1.Notice('WebSocket connection closed. Please restart recording.');
                this.stopRecording();
            }
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            new obsidian_1.Notice('WebSocket error. Please check the console for details.');
            if (this.isRecording) {
                this.stopRecording();
            }
        };
    }

    startAudioCapture() {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then((stream) => {
                this.stream = stream;
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
                const source = this.audioContext.createMediaStreamSource(stream);

                this.audioContext.audioWorklet.addModule(this.getAudioWorkletUrl())
                    .then(() => {
                        const workletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');

                        source.connect(workletNode);
                        workletNode.connect(this.audioContext.destination);

                        workletNode.port.onmessage = (event) => {
                            if (this.isRecording && this.ws && this.ws.readyState === WebSocket.OPEN) {
                                this.ws.send(event.data);
                            }
                        };

                        this.mediaRecorder = new MediaRecorder(stream);
                        this.mediaRecorder.start();
                    })
                    .catch((error) => {
                        console.error('Error loading AudioWorklet:', error);
                        new obsidian_1.Notice('Error loading AudioWorklet. Please check the console for details.');
                    });
            })
            .catch((error) => {
                console.error('Error accessing microphone:', error);
                new obsidian_1.Notice('Error accessing microphone. Please check the console for details.');
            });
    }

    getAudioWorkletUrl() {
        const blob = new Blob([`
            class AudioProcessor extends AudioWorkletProcessor {
                process(inputs, outputs, parameters) {
                    const input = inputs[0];
                    const output = new Int16Array(input[0].length);
                    for (let i = 0; i < input[0].length; i++) {
                        output[i] = Math.max(-1, Math.min(1, input[0][i])) * 0x7FFF;
                    }
                    this.port.postMessage(output.buffer);
                    return true;
                }
            }
            registerProcessor('audio-processor', AudioProcessor);
        `], { type: 'application/javascript' });
        return URL.createObjectURL(blob);
    }

    updateTranscriptionModal(text) {
        try {
            const data = JSON.parse(text);
            if (data.text && this.transcriptionModal) {
                const trimmedText = data.text.trim();
                this.transcriptionModal.updateTranscription(trimmedText);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    }
}

exports.default = AudioTranscriptionPlugin;
