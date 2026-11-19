module.exports = {
    env: {
        browser: true,
        es2022: true,
    },
    extends: ['airbnb-base'],
    ignorePatterns: ['.deployments/', 'node_modules/'],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    rules: {
        'function-paren-newline': 'off',
        'import/extensions': 'off',
        'import/prefer-default-export': 'off',
        'max-len': 'off',
        'no-alert': 'off',
        'no-await-in-loop': 'off',
        'no-bitwise': 'off',
        'no-param-reassign': 'off',
        'no-use-before-define': ['error', { functions: false }],
        'object-curly-newline': 'off',
        'object-property-newline': 'off',
        'consistent-return': 'off',
    },
};
