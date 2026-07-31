// Permisiuni comune pentru toate paginile panelului.
const Roles = {
    GUEST: 0,
    EL_MECANICO: 1,
    MECANIC: 1,
    SEF_MECANIC: 2,
    LA_FAMILIA: 3,
    MANAGER: 4,
    COLIDER: 5,
    LIDER: 6,
    COORDONATOR: 7,

    // Roluri tehnice cu acces administrativ maxim
    ADMIN: 7,
    OWNER: 7
};

const PagePermissions = {
    // Nivel 1: El Mecanico și toate rolurile superioare
    'index.html': 1,
    'asistent.html': 1,
    'pontaj.html': 1,
    'cereri.html': 1,
    'craftmecanics.html': 1,
    'marketplace.html': 1,
    'anunturi.html': 1,

    // Nivel 3: La Familia și rolurile superioare
    'calculatorilegal.html': 3,
    'locatiiilegale.html': 3,
    'marketplace-ilegal.html': 3,

    // Nivel 4: Manager și rolurile superioare
    'rapoarte.html': 4,
    'contracte.html': 4,

    // Nivel 7: numai Coordonator, Admin și Owner
    'logs.html': 7,
    'admin.html': 7,
    'edit.html': 7
};

const STORAGE_KEY = 'discord_user';

function isLogged() {
    return getUser() !== null;
}

function getUser() {
    try {
        const userData = localStorage.getItem(STORAGE_KEY);
        return userData ? JSON.parse(userData) : null;
    } catch (error) {
        console.error('Eroare la citirea utilizatorului:', error);
        return null;
    }
}

function getRole() {
    const user = getUser();

    if (!user) {
        return 0;
    }

    // Denumirea rolului poate fi personalizată pentru orice server.
    // Nivelul numeric primit la autentificare rămâne sursa sigură de acces.
    const savedPermissionLevel = Number(user.permission_level);
    if (Number.isInteger(savedPermissionLevel) && savedPermissionLevel >= 0 && savedPermissionLevel <= 7) {
        return savedPermissionLevel;
    }

    const roleValue = user.role || user.default_role;

    // Acceptă rolurile salvate direct ca numere.
    if (typeof roleValue === 'number') {
        return roleValue >= 0 && roleValue <= 7
            ? roleValue
            : 0;
    }

    if (typeof roleValue !== 'string') {
        return 0;
    }

    const role = roleValue
        .trim()
        .toLocaleLowerCase('ro-RO');

    // Acceptă și nivelurile salvate ca text: "1", "2", ..., "7".
    const numericRole = Number(role);

    if (Number.isInteger(numericRole)) {
        return numericRole >= 0 && numericRole <= 7
            ? numericRole
            : 0;
    }

    // Roluri tehnice cu acces administrativ maxim.
    if (
        role === 'admin' ||
        role === 'administrator' ||
        role === 'owner'
    ) {
        return Roles.ADMIN;
    }

    // Coordonatorul este rolul principal administrativ.
    if (role.includes('coordonator')) {
        return Roles.COORDONATOR;
    }

    /*
     * Verificarea CoLider trebuie făcută înainte de Lider,
     * deoarece textul "colider" conține și cuvântul "lider".
     */
    if (
        role === 'colider' ||
        role === 'co-lider' ||
        role === 'co lider'
    ) {
        return Roles.COLIDER;
    }

    if (role === 'lider') {
        return Roles.LIDER;
    }

    if (role.includes('manager')) {
        return Roles.MANAGER;
    }

    if (
        role.includes('la familia') ||
        role === 'familia'
    ) {
        return Roles.LA_FAMILIA;
    }

    if (
        role.includes('sef mecanic') ||
        role.includes('șef mecanic')
    ) {
        return Roles.SEF_MECANIC;
    }

    if (
        role.includes('el mecanico') ||
        role.includes('mecanic')
    ) {
        return Roles.EL_MECANICO;
    }

    return 0;
}

function hasRole(requiredRole) {
    return getRole() >= requiredRole;
}

function logout() {
    localStorage.clear();
    window.location.href = 'login.html';
}

(function initSecurityMiddleware() {
    const currentPage =
        window.location.pathname.split('/').pop() || 'index.html';

    // Pagini publice.
    if (
        currentPage === 'login.html' ||
        currentPage === '403.html'
    ) {
        return;
    }

    // guest.html necesită autentificare,
    // dar este destinată exclusiv Vizitatorilor.
    if (currentPage === 'guest.html') {
        if (!isLogged()) {
            window.location.href = 'login.html';
            return;
        }

        if (getRole() > Roles.GUEST) {
            window.location.href = 'index.html';
            return;
        }

        return;
    }

    if (!isLogged()) {
        window.location.href = 'login.html';
        return;
    }

    const currentRole = getRole();

    // Vizitatorii merg doar pe guest.html
    if (currentRole === Roles.GUEST && currentPage !== 'guest.html') {
        window.location.href = 'guest.html';
        return;
    }

    // Dacă utilizatorul primește un rol și încearcă să intre pe guest.html,
    // îl trimitem în panelul principal.
    if (currentRole > Roles.GUEST && currentPage === 'guest.html') {
        window.location.href = 'index.html';
        return;
    }

    const requiredRole = PagePermissions[currentPage];

    if (
        requiredRole !== undefined &&
        currentRole < requiredRole
    ) {
        window.location.href = '403.html';
        return;
    }

        document.addEventListener('DOMContentLoaded', () => {
            applyRoleBasedVisibility(getRole());
        });
    })();

function applyRoleBasedVisibility(userRole) {
    document.querySelectorAll('[data-role]').forEach((element) => {
        const requiredRole = Number.parseInt(
            element.getAttribute('data-role'),
            10
        );

        if (!Number.isNaN(requiredRole)) {
            element.style.display =
                userRole < requiredRole ? 'none' : '';
        }
    });
}
