import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

/** Form-group validator: password and confirmPassword must match when confirm has a value. */
export function passwordMatchValidator(
  passwordKey = 'password',
  confirmKey = 'confirmPassword',
): ValidatorFn {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey);
    const confirm = group.get(confirmKey);
    if (!password || !confirm) {
      return null;
    }

    const confirmValue = confirm.value ?? '';
    if (confirmValue === '') {
      return null;
    }

    return password.value === confirmValue ? null : { passwordMismatch: true };
  };
}
