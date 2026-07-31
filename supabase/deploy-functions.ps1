param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'

Write-Host 'Se conectează proiectul Supabase...'
supabase link --project-ref $ProjectRef

Write-Host 'Se publică funcțiile Edge...'
$functions = @(
    'sync-discord-role',
    'manage-discord-config',
    'manage-community-posts',
    'send-discord-notification',
    'close-expired-shifts',
    'manage-admin-center'
)

foreach ($functionName in $functions) {
    Write-Host "Deploy: $functionName"
    supabase functions deploy $functionName --no-verify-jwt
}

Write-Host 'Funcțiile au fost publicate. Configurează acum secretele din Supabase Dashboard.'
