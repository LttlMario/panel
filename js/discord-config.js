// Configurație publică Discord OAuth

window.PANEL_DISCORD_CONFIG = Object.freeze({

    organization: {
        id: "familia-es-todo",
        name: "Familia Es Todo"
    },


    // SINGURA APLICAȚIE CARE FACE LOGIN
    clientId: "1530859145459138601",


    scopes: [
        "identify",
        "email",
        "guilds.members.read"
    ]

});
