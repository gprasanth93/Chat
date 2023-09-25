document.addEventListener("DOMContentLoaded", () => {
    // Connect to the WebTransport endpoint
    const transport = new WebTransport("ws://localhost:8000/ws");

    transport.onstatechange = () => {
        if (transport.state === "established") {
            console.log("WebTransport connection established");

            // Set up event listeners for sending and receiving messages
            document.getElementById("message-input").addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    sendMessage();
                }
            });
        }
    };

    transport.onmessage = (event) => {
        const message = event.data;
        displayMessage(message);
    };

    function sendMessage() {
        const inputElement = document.getElementById("message-input");
        const message = inputElement.value;
        inputElement.value = "";
        
        if (message) {
            transport.send(message);
            displayMessage(`You: ${message}`);
        }
    }

    function displayMessage(message) {
        const messagesElement = document.getElementById("chat-messages");
        const messageElement = document.createElement("p");
        messageElement.textContent = message;
        messagesElement.appendChild(messageElement);
    }
});
