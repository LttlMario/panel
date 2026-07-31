// Configurație publică Discord OAuth.
// Pentru mutarea pe altă aplicație Discord, modifică doar valorile de mai jos.

window.PANEL_DISCORD_CONFIG = Object.freeze({

    organization: {
        id: "familia-es-todo",
        name: "Familia Es Todo"
    },

    // Discord principal folosit la autentificare
    clientId: "1530859145459138601",

    scopes: [
        "identify",
        "email",
        "guilds.members.read"
    ],

    // Discord-uri configurate pentru organizație
    discords: [

        {
            id: "principal",
            name: "Discord Principal",
            enabled: true,

            clientId: "1530859145459138601",

            scopes: [
                "identify",
                "email",
                "guilds.members.read"
            ]
        },

        {
            id: "secondary",
            name: "Discord Secundar",
            enabled: false,

            clientId: "",

            scopes: [
                "identify",
                "email",
                "guilds.members.read"
            ]
        }

    ]

});
