import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RelatorioCadastrosComponent } from './relatorio-cadastros.component';

describe('RelatorioCadastrosComponent', () => {
  let component: RelatorioCadastrosComponent;
  let fixture: ComponentFixture<RelatorioCadastrosComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RelatorioCadastrosComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RelatorioCadastrosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
